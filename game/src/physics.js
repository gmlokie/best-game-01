// NEON RUSH — kart kinematics, drift, and collisions.
// Pure fixed-step physics: every function takes a dt and mutates kart state
// deterministically. No clocks, no randomness here — the only random input is
// the per-kart skill jitter the race module seeds at setup time.

import {
  TRACK_POINTS,
  TRACK_SAMPLES,
  TRACK_HALF_WIDTH,
  nearestSample,
  closestPoint,
  lateralOffset,
} from './track.js';

export const KART_RADIUS = 14;

// Tuning knobs, one place, so the race stays fair and fun to drive.
export const PHYSICS = {
  accel: 430, // px/s^2 while the throttle is down
  brake: 700, // px/s^2 while braking
  reverseAccel: 260,
  maxSpeed: 540,
  maxReverse: 160,
  drag: 0.55, // 1/s proportional drag
  offTrackDrag: 2.1, // extra drag when all four wheels are off the asphalt
  offTrackMax: 235, // speed cap while off track
  steerRate: 2.6, // rad/s at full lock and full grip
  driftSteerBoost: 1.45, // extra yaw while drifting
  driftChargeRate: 0.55, // boost meter per second of drifting
  driftMinCharge: 0.35, // meter needed before releasing gives a boost
  boostAccel: 620, // extra accel while boosting
  boostMaxSpeed: 720,
  boostDrain: 0.5, // meter per second while the boost key is held
  padBoostTime: 0.9, // seconds of boost from a pad
};

export function makeKart(id, name, color, isPlayer) {
  return {
    id,
    name,
    color,
    isPlayer,
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    steer: 0, // smoothed steering input, -1..1
    drifting: false,
    driftTime: 0,
    driftDir: 0,
    boostMeter: 0.4, // start with a little charge so the first corner matters
    boostTime: 0, // seconds of pad/boost-key boost remaining
    boosting: false,
    offTrack: false,
    sample: 0, // nearest track sample, updated every step
    lateral: 0,
    lap: 0,
    checkpoint: 0, // next checkpoint index to hit (0..15); lap counts at 0 again
    lapStartTime: 0,
    lapTimes: [],
    bestLap: 0,
    finished: false,
    finishTime: 0,
    progress: 0, // laps * samples + sample, for standings
    raceTime: 0,
    wallHit: 0, // cooldown so one scrape sparks once
    padCooldown: 0,
    skill: { topSpeed: 1, corner: 1, accel: 1 },
    rubberBand: 1,
    smokeTimer: 0,
  };
}

// Place a kart on the grid: staggered rows behind the start line, offset
// sideways so karts do not start stacked on each other.
export function placeOnGrid(kart, gridSlot) {
  const row = Math.floor(gridSlot / 2);
  const side = gridSlot % 2 === 0 ? -1 : 1;
  const back = 46 + row * 44;
  // Grid slots sit behind the start line, so their sample index wraps to
  // the end of the table (about 9 px of track per sample).
  const sampleIndex = (TRACK_SAMPLES - Math.round(back / 9)) % TRACK_SAMPLES;
  const p = TRACK_POINTS[sampleIndex];
  const lat = side * 26;
  kart.x = p.x - p.ty * lat;
  kart.y = p.y + p.tx * lat;
  kart.angle = p.angle;
  kart.speed = 0;
  kart.sample = sampleIndex;
  kart.lateral = lat;
  kart.checkpoint = 1; // gate 0 (start line) is already behind the kart
  kart.lap = 0;
  kart.progress = sampleIndex - TRACK_SAMPLES; // negative: behind the line
}

// One fixed step of driving for a single kart.
// input: { throttle: -1..1, steer: -1..1, drift: bool, boost: bool }
export function stepKart(kart, input, dt) {
  const P = PHYSICS;
  const boosting = kart.boostTime > 0 || (input.boost && kart.boostMeter > 0.02);
  kart.boosting = boosting;

  // --- steering (smoothed, grip falls off at very low speed) ---
  const targetSteer = input.steer;
  kart.steer += (targetSteer - kart.steer) * Math.min(1, dt * 10);
  const speedFactor = Math.min(1, Math.abs(kart.speed) / 120);
  let yawRate = kart.steer * P.steerRate * speedFactor;
  if (kart.speed < 0) yawRate = -yawRate;

  // --- drift: hold drift while steering hard at speed; charging builds meter ---
  const wantDrift =
    input.drift && Math.abs(input.steer) > 0.45 && Math.abs(kart.speed) > 200;
  if (wantDrift && !kart.drifting) {
    kart.drifting = true;
    kart.driftDir = input.steer > 0 ? 1 : -1;
    kart.driftTime = 0;
  }
  if (kart.drifting) {
    if (!wantDrift) {
      // Release: a charged drift pays out as a boost burst.
      if (kart.driftTime * P.driftChargeRate >= P.driftMinCharge) {
        kart.boostTime = Math.max(
          kart.boostTime,
          0.45 + kart.driftTime * P.driftChargeRate * 0.9,
        );
      }
      kart.drifting = false;
      kart.driftTime = 0;
    } else {
      kart.driftTime += dt;
      kart.boostMeter = Math.min(
        1,
        kart.boostMeter + P.driftChargeRate * dt * 0.6,
      );
      yawRate *= P.driftSteerBoost;
    }
  }

  // --- longitudinal forces ---
  const topSpeed = (boosting ? P.boostMaxSpeed : P.maxSpeed) * kart.skill.topSpeed;
  if (input.throttle > 0) {
    kart.speed += P.accel * kart.skill.accel * input.throttle * dt;
    if (boosting) kart.speed += P.boostAccel * dt;
  } else if (input.throttle < 0) {
    if (kart.speed > 5) kart.speed -= P.brake * dt;
    else kart.speed += P.reverseAccel * input.throttle * dt; // reversing
  }
  if (input.boost && kart.boostMeter > 0) {
    kart.boostMeter = Math.max(0, kart.boostMeter - P.boostDrain * dt);
  }
  if (kart.boostTime > 0) kart.boostTime -= dt;

  // --- drag, off-track penalty, clamps ---
  const near = nearestSample(kart.x, kart.y, kart.sample);
  kart.sample = near.index;
  kart.lateral = lateralOffset(kart.x, kart.y, near.index);
  kart.offTrack = Math.abs(kart.lateral) > TRACK_HALF_WIDTH - 6;
  kart.speed -= kart.speed * P.drag * dt;
  if (kart.offTrack) {
    kart.speed -= kart.speed * P.offTrackDrag * dt;
    if (kart.speed > P.offTrackMax) kart.speed = P.offTrackMax;
    if (kart.speed < -P.offTrackMax) kart.speed = -P.offTrackMax;
  }
  if (kart.speed > topSpeed) kart.speed = topSpeed;
  if (kart.speed < -P.maxReverse) kart.speed = -P.maxReverse;

  // --- integrate ---
  kart.angle += yawRate * dt * (kart.drifting ? 1 : 1);
  // Drifting karts slide: velocity lags behind heading a little.
  const slide = kart.drifting ? 0.22 * kart.driftDir : 0;
  const moveAngle = kart.angle + slide * speedFactor;
  kart.x += Math.cos(moveAngle) * kart.speed * dt;
  kart.y += Math.sin(moveAngle) * kart.speed * dt;

  // --- walls: clamp to the track edge, bleed speed, flag a scrape ---
  // The clamp projects onto the nearest track segment (closestPoint), so a
  // kart sliding along the wall keeps its along-track progress instead of
  // being snapped back to a sample point every step.
  const wall = closestPoint(kart.x, kart.y, kart.sample);
  kart.sample = Math.round(wall.sample) % TRACK_SAMPLES;
  kart.lateral = wall.lateral;
  const maxLat = TRACK_HALF_WIDTH - KART_RADIUS;
  if (Math.abs(wall.lateral) > maxLat) {
    const sign = wall.lateral > 0 ? 1 : -1;
    const clamped = sign * maxLat;
    kart.x = wall.x - wall.ty * clamped;
    kart.y = wall.y + wall.tx * clamped;
    kart.lateral = clamped;
    // A fresh scrape costs speed and sparks once; sliding along the wall
    // afterwards only drags a little, so a kart can recover instead of
    // getting pinned at a crawl against the barrier.
    if (Math.abs(kart.speed) > 140 && kart.wallHit <= 0) {
      kart.wallHit = 0.35;
      kart.speed *= 0.86;
    } else {
      kart.speed *= 0.998;
    }
    // Scrub the kart's heading back toward the track direction.
    let diff = wall.angle - kart.angle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    kart.angle += diff * 0.25;
  }
  if (kart.wallHit > 0) kart.wallHit -= dt;
  if (kart.padCooldown > 0) kart.padCooldown -= dt;

  // Progress is monotonic for standings. A kart still on lap 0 but sitting
  // behind the start line (grid slots live near the end of the sample table)
  // counts as negative progress, not as nearly a lap done.
  kart.progress = kart.lap * TRACK_SAMPLES + kart.sample;
  if (kart.lap === 0 && kart.sample > (TRACK_SAMPLES * 3) / 4) {
    kart.progress -= TRACK_SAMPLES;
  }
}

// Kart-to-kart collision: circles push apart positionally every step, and
// only a hard overlap trades speed — a light bump must not stall the pack.
// Deterministic: pairs are visited in id order.
export function collideKarts(karts) {
  for (let i = 0; i < karts.length; i += 1) {
    for (let j = i + 1; j < karts.length; j += 1) {
      const a = karts[i];
      const b = karts[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const min = KART_RADIUS * 2;
      if (dist > 0.001 && dist < min) {
        const push = (min - dist) / 2;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
        // Hard overlap only: the faster kart sheds a little, the slower one
        // gains a little. A graze costs nothing.
        if (dist < min * 0.8) {
          const avg = (a.speed + b.speed) / 2;
          a.speed = avg * 0.99 + a.speed * 0.01;
          b.speed = avg * 0.99 + b.speed * 0.01;
          if (a.wallHit <= 0) a.wallHit = 0.2;
          if (b.wallHit <= 0) b.wallHit = 0.2;
        }
      }
    }
  }
}
