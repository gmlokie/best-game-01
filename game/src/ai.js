// NEON RUSH — AI opponents.
// Each AI kart chases a point on the racing line ahead of it, brakes for
// corners by reading the track curvature, and rubber-bands a little so the
// pack stays together: faster when behind the player, slower when ahead.
// Skill differs per kart (top speed, cornering, aggression), seeded at race
// setup, so the same seed always fields the same seven rivals.

import {
  TRACK_POINTS,
  TRACK_SAMPLES,
  TRACK_HALF_WIDTH,
  curvatureAhead,
} from './track.js';

// Racing-line offsets, in pixels from the centreline. The AI does not hug
// the middle: each kart picks a lane, and aggressive karts swing wider to
// set up an overtake when the kart ahead is close.
const LANE_OFFSETS = [-34, -18, 0, 18, 34, -26, 10];

export function makeAiDriver(kart, skillSeed) {
  return {
    kart,
    lane: LANE_OFFSETS[kart.id % LANE_OFFSETS.length],
    aggression: 0.45 + ((skillSeed * 37) % 100) / 100 * 0.5,
    wobblePhase: skillSeed * 1.7,
  };
}

// Where the kart wants to be, a few samples ahead of its current position.
// Returns a world point on (or near) the centreline.
export function aiTargetPoint(driver, time) {
  const kart = driver.kart;
  // Short lookahead on twisty sections so the kart follows the curve
  // instead of cutting the chord into the inside wall; longer on straights.
  const bend = curvatureAhead(kart.sample, 20);
  const lookahead = bend > 0.2 ? 11 : 14 + Math.floor(Math.abs(kart.speed) / 45);
  const targetSample = (kart.sample + lookahead) % TRACK_SAMPLES;
  const p = TRACK_POINTS[targetSample];
  // Gentle sinusoidal wobble so the AI line looks alive, not robotic.
  const wobble = Math.sin(time * 0.7 + driver.wobblePhase) * 6;
  const lat = driver.lane + wobble;
  return { x: p.x - p.ty * lat, y: p.y + p.tx * lat, sample: targetSample };
}

// Target speed from the corner ahead: tight corners mean lifting off, and
// karts with a better corner skill carry more speed through them.
export function aiTargetSpeed(driver) {
  const kart = driver.kart;
  const bend = curvatureAhead(kart.sample, 26);
  const cornerFactor = 1 - Math.min(0.55, bend * 1.15) * (1.15 - kart.skill.corner * 0.35);
  const base = 520 * kart.skill.topSpeed * kart.rubberBand;
  return base * cornerFactor;
}

// Decide this step's inputs for one AI kart.
// playerProgress: the player's progress value, for rubber-banding.
// rivals: all karts, so an aggressive driver can aim around the kart ahead.
export function aiInput(driver, time, playerProgress, rivals) {
  const kart = driver.kart;
  const target = aiTargetPoint(driver, time);

  // Steering: angle to the target point, clamped to full lock.
  const dx = target.x - kart.x;
  const dy = target.y - kart.y;
  const wantAngle = Math.atan2(dy, dx);
  let diff = wantAngle - kart.angle;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  let steer = Math.max(-1, Math.min(1, diff * 2.4));

  // Overtake nudge: if a rival is just ahead and close, swing to the side
  // with more room instead of sitting in its slipstream forever.
  const ahead = nearestRivalAhead(kart, rivals);
  if (ahead && ahead.gap < 70 && driver.aggression > 0.6) {
    const side = ahead.lateral > 0 ? -1 : 1;
    steer = Math.max(-1, Math.min(1, steer + side * 0.35));
  }

  // Throttle: full gas unless the corner ahead (or a wall scrape) says slow.
  const targetSpeed = aiTargetSpeed(driver);
  let throttle = 1;
  if (kart.speed > targetSpeed) throttle = 0.15;
  if (kart.speed > targetSpeed * 1.12) throttle = -0.4;
  if (kart.offTrack) throttle = 1; // floor it to get back on the asphalt

  // Drift through sharp corners: hold drift while turning hard at speed.
  const bend = curvatureAhead(kart.sample, 18);
  const drift = bend > 0.22 && Math.abs(steer) > 0.55 && kart.speed > 260;

  // Boost: spend the meter on the straight after a corner, or when far behind.
  const behind = playerProgress - kart.progress;
  const boost = kart.boostMeter > 0.55 && (bend < 0.08 || behind > 500);

  return { throttle, steer, drift, boost };
}

// The closest rival in front of this kart, within one lookahead window.
function nearestRivalAhead(kart, rivals) {
  let best = null;
  for (const other of rivals) {
    if (other === kart) continue;
    const gap = other.progress - kart.progress;
    if (gap > 0 && gap < 160) {
      const dx = other.x - kart.x;
      const dy = other.y - kart.y;
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) {
        best = { gap, dist, lateral: other.lateral };
      }
    }
  }
  return best;
}

// Rubber-band factor for one AI kart: 1.0 at the player's pace, up to +9%
// when well behind, down to -7% when well ahead. Gentle on purpose — the
// player should feel the pack breathe, not teleport.
export function rubberBandFor(kart, playerProgress) {
  const diff = playerProgress - kart.progress;
  if (diff > 0) return Math.min(1.09, 1 + diff / 6000);
  return Math.max(0.93, 1 + diff / 9000);
}
