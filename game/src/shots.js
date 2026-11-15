// NEON RUSH — deterministic screenshot scenes.
// ?shot=title|race|drift|results sets up one exact scene from the fixed
// seed, so the four screenshots are reproducible renders of the real game.
// The scenes drive the same race state the player sees: nothing here is a
// mock or a separate render path. Times are fixed-step counts, never wall
// clocks, so the same query always paints the same frame.

import { makeRace, RACE_SEED } from './race.js';
import { TRACK_POINTS, TRACK_SAMPLES, CHECKPOINT_SAMPLES, elevationAt } from './track.js';
import { spawnDriftSmoke, spawnBoostFlame, spawnSpeedLine, spawnConfetti } from './particles.js';

const STEP = 1 / 120;

// Put a kart at a point along the track and give it race state as if it had
// driven there cleanly: lap, checkpoint, lap times, and progress to match.
export function placeKartAtProgress(race, kart, lap, sample) {
  kart.lap = lap;
  kart.sample = sample;
  kart.checkpoint = 1;
  // Checkpoints passed: every gate whose sample is behind this sample.
  let passed = 0;
  for (let c = 1; c < CHECKPOINT_SAMPLES.length; c += 1) {
    if (CHECKPOINT_SAMPLES[c] <= sample) passed = c;
  }
  kart.checkpoint = passed + 1;
  if (kart.checkpoint > 15) kart.checkpoint = 15;
  const p = TRACK_POINTS[sample];
  const lat = (kart.id % 3 - 1) * 24;
  kart.x = p.x - p.ty * lat;
  kart.y = p.y + p.tx * lat;
  kart.angle = p.angle;
  kart.speed = 380 + kart.id * 12;
  kart.lateral = lat;
  kart.lapStartTime = 0;
  kart.lapTimes = lap > 0 ? [58.4 + kart.id * 1.7, 57.9 + kart.id * 1.3].slice(0, lap) : [];
  kart.bestLap = kart.lapTimes.length > 0 ? Math.min(...kart.lapTimes) : 0;
  kart.progress = lap * TRACK_SAMPLES + sample;
}

export function setupShot(race, shot) {
  if (shot === 'title') {
    race.state = 'menu';
    race.frame = 90; // menu blink mid-cycle, deterministic
    return race;
  }
  if (shot === 'race') {
    // Mid-race pack battle, lap 2, karts bunched around a corner.
    race.state = 'racing';
    race.raceTime = 96.42;
    const packSamples = [210, 198, 226, 188, 240, 176, 252, 164];
    race.karts.forEach((kart, i) => {
      placeKartAtProgress(race, kart, 1, packSamples[i]);
    });
    race.player.lapTimes = [58.214];
    race.player.bestLap = 58.214;
    race.player.lapStartTime = 58.214;
    return race;
  }
  if (shot === 'drift') {
    // Player mid-drift through a hairpin, boost meter full, flames + smoke.
    race.state = 'racing';
    race.raceTime = 121.85;
    const driftSamples = [330, 318, 344, 306, 356, 296, 366, 288];
    race.karts.forEach((kart, i) => {
      placeKartAtProgress(race, kart, 1, driftSamples[i]);
    });
    const player = race.player;
    player.drifting = true;
    player.driftDir = 1;
    player.driftTime = 1.1;
    player.boostMeter = 1;
    player.boosting = true;
    player.boostTime = 0.8;
    player.speed = 505;
    player.lapTimes = [58.214];
    player.bestLap = 58.214;
    player.lapStartTime = 58.214;
    for (let i = 0; i < 14; i += 1) {
      const backX = player.x - Math.cos(player.angle) * (14 + i * 5);
      const backY = player.y - Math.sin(player.angle) * (14 + i * 5);
      spawnDriftSmoke(
        race.particles,
        backX,
        elevationAt(player.sample) + 0.8,
        -backY,
        -Math.cos(player.angle) * 30,
        0,
        Math.sin(player.angle) * 30,
        player.color,
      );
      spawnBoostFlame(
        race.particles,
        backX,
        elevationAt(player.sample) + 1,
        -backY,
        player.angle,
      );
    }
    for (let i = 0; i < 5; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      spawnSpeedLine(
        race.particles,
        player.x + Math.cos(player.angle + side * 1.2) * (180 + i * 40),
        elevationAt(player.sample) + 2,
        -(player.y + Math.sin(player.angle + side * 1.2) * (180 + i * 40)),
        player.angle,
        46,
      );
    }
    return race;
  }
  if (shot === 'results') {
    // Final standings: the player won a close race, full table + lap times.
    race.state = 'results';
    race.raceTime = 178.632;
    // Frame 90 keeps the "PRESS R" blink lit (sin(90 * 0.09) > 0).
    race.frame = 90;
    const finishOrder = [0, 1, 3, 2, 4, 6, 5, 7];
    const finishTimes = [178.632, 179.841, 181.205, 182.977, 185.43, 188.102, 191.55, 196.208];
    race.karts.forEach((kart, i) => {
      const slot = finishOrder.indexOf(i);
      kart.finished = true;
      kart.finishTime = finishTimes[slot];
      kart.lap = 3;
      kart.sample = 12 + slot * 6;
      kart.checkpoint = 1;
      kart.lapTimes = [58.214 + slot * 1.1, 59.02 + slot * 0.9, 61.4 + slot * 1.4];
      kart.bestLap = Math.min(...kart.lapTimes);
      kart.progress = 3 * TRACK_SAMPLES + kart.sample;
      const p = TRACK_POINTS[kart.sample];
      const lat = (slot % 2 === 0 ? -1 : 1) * 22;
      kart.x = p.x - p.ty * lat;
      kart.y = p.y + p.tx * lat;
      kart.angle = p.angle;
      kart.speed = 0;
    });
    // Winner's confetti, frozen mid-burst above the player's kart. Each
    // piece is advanced 0.6 s along its velocity so the burst reads as a
    // spread cloud instead of a single point (deterministic, fixed factor).
    spawnConfetti(
      race.particles,
      race.player.x,
      elevationAt(race.player.sample) + 10,
      -race.player.y,
      race.karts.map((k) => k.color),
    );
    for (const p of race.particles.list) {
      p.x += p.vx * 0.6;
      p.y += p.vy * 0.6;
      p.z += p.vz * 0.6;
      p.life = 1.0;
      p.maxLife = 1.4;
    }
    return race;
  }
  return race;
}

// Build a fresh race and apply a shot scene to it. main.js calls this when
// the URL carries ?shot=.
export function raceForShot(shot) {
  const race = makeRace(RACE_SEED);
  return setupShot(race, shot);
}
