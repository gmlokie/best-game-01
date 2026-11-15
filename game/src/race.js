// NEON RUSH — race state machine.
// Menu -> countdown -> racing -> results, plus pause, restart, and the
// Neon League flow (results -> season shop -> next race -> champion).
// Owns the karts, the AI drivers, lap + checkpoint validation, boost pads,
// standings, and the race clock. The clock only advances during racing,
// and every step is a fixed dt, so a race is fully reproducible from its
// seed. Modes:
//   single — one race on one track, default PRO difficulty.
//   league — a 3-race season over all three tracks, championship points,
//     credits, and a shop between races (see league.js).

import { makeRng, range } from './rng.js';
import {
  TRACK_SAMPLES,
  CHECKPOINT_SAMPLES,
  CHECKPOINT_COUNT,
  BOOST_PADS,
  LAP_COUNT,
  elevationAt,
  loadTrack,
  applyPadLayout,
  padLayoutsForRace,
} from './track.js';
import {
  makeKart,
  placeOnGrid,
  stepKart,
  collideKarts,
  PHYSICS,
} from './physics.js';
import { makeAiDriver, aiInput, rubberBandFor } from './ai.js';
import {
  DIFFICULTIES,
  POINTS_TABLE,
  makeLeague,
  awardRace,
  buyUpgrade,
  applyUpgrades,
  championIndex,
  loadUnlocks,
  unlockTrack,
} from './league.js';
import {
  makeParticles,
  stepParticles,
  spawnDriftSmoke,
  spawnBoostFlame,
  spawnWallSparks,
  spawnSpeedLine,
  spawnConfetti,
} from './particles.js';
import {
  makeAudio,
  ensureAudio,
  updateEngineSound,
  stopEngineSound,
  playCountdownBeep,
  playClick,
  playBoostWhoosh,
  playScrape,
  playFanfare,
  toggleMute,
} from './audio.js';
import { drivingInput, wasPressed } from './input.js';

export const RACE_SEED = 1337;

export const KART_DEFS = [
  { name: 'YOU', color: '#22d3ee', player: true },
  { name: 'VEX', color: '#ff2e88', player: false },
  { name: 'NOVA', color: '#ffb020', player: false },
  { name: 'ORBIT', color: '#7c5cff', player: false },
  { name: 'PIXEL', color: '#39ff88', player: false },
  { name: 'ZEPHYR', color: '#ff5e3a', player: false },
  { name: 'LUMEN', color: '#f5f0ff', player: false },
  { name: 'COMET', color: '#ffe66d', player: false },
];

// Wind (B8): a slow lateral drift, a pure function of race time so it
// stays deterministic. Max ~18 px/s — the AI and the player both steer
// against it, so it reads as a handling variable, not a shove.
export function windAt(t) {
  return { x: 18 * Math.sin(t * 0.31), y: 18 * Math.cos(t * 0.23) };
}

export function makeRace(seed, options) {
  const opts = {
    trackIndex: 0,
    difficulty: 1, // PRO
    upgrades: null,
    mode: 'single',
    league: null,
    ...(options || {}),
  };
  loadTrack(opts.trackIndex);
  const difficulty = DIFFICULTIES[opts.difficulty] || DIFFICULTIES[1];
  const rng = makeRng(seed);
  const karts = KART_DEFS.map((def, i) => {
    const kart = makeKart(i, def.name, def.color, def.player);
    // Skill varies per kart but stays close: the field is competitive, and
    // the player kart is mid-pack on raw pace so driving matters.
    // Difficulty sets the AI ranges; the player is always 1.0 base, plus
    // any league upgrades bought between races.
    if (def.player) {
      kart.skill = { topSpeed: 1, corner: 1, accel: 1, handling: 1, boost: 1 };
      if (opts.upgrades) kart.skill = applyUpgrades(kart.skill, opts.upgrades);
    } else {
      kart.skill = {
        topSpeed: range(rng, difficulty.ai.topSpeed[0], difficulty.ai.topSpeed[1]),
        corner: range(rng, difficulty.ai.corner[0], difficulty.ai.corner[1]),
        accel: range(rng, difficulty.ai.accel[0], difficulty.ai.accel[1]),
        handling: 1,
        boost: 1,
      };
    }
    return kart;
  });
  // Grid order is shuffled (seeded) so the player does not always start last.
  const order = [];
  for (let i = 0; i < karts.length; i += 1) order.push(i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  order.forEach((kartId, slot) => placeOnGrid(karts[kartId], slot));
  const drivers = karts.map((kart) => makeAiDriver(kart, 11 + kart.id * 7));
  // Boost pads shift every lap (B8): one seeded layout per lap.
  const padLayouts = padLayoutsForRace(seed, LAP_COUNT);
  applyPadLayout(padLayouts[0]);
  return {
    seed,
    options: opts,
    difficulty,
    laps: LAP_COUNT,
    state: 'menu', // menu | countdown | racing | paused | results | season | champion
    prevState: 'racing',
    karts,
    drivers,
    player: karts[0],
    particles: makeParticles(),
    audio: makeAudio(),
    raceTime: 0,
    countdownT: 0,
    countdownBeep: 4,
    shake: 0,
    resultsAt: 0,
    fanfarePlayed: false,
    confettiDone: false,
    message: '',
    messageT: 0,
    autoDrive: false, // headless test mode: the player kart is AI-driven
    frame: 0,
    wind: { x: 0, y: 0 },
    padLayouts,
    padVersion: 0, // bumps when the pads move, so the renderer repositions them
    mode: opts.mode,
    league: opts.league, // league state object, or null in single mode
    unlocks: loadUnlocks(),
    resultsData: null, // { position, points, credits, bestLapBonus } after a league race
    // Menu selection (main.js + hud.js own it; the race never reads it).
    menuSel: { mode: 'single', trackIndex: 0, difficulty: 1 },
  };
}

export function startCountdown(race) {
  race.state = 'countdown';
  race.countdownT = 3.2;
  race.countdownBeep = 4;
  race.raceTime = 0;
  playClick(race.audio);
}

export function resetRace(race) {
  const keepAudio = race.audio;
  const keepAutoDrive = race.autoDrive;
  const fresh = makeRace(race.seed, race.options);
  Object.keys(fresh).forEach((key) => {
    race[key] = fresh[key];
  });
  // Keep the live AudioContext across restarts so beeps keep working.
  race.audio = keepAudio;
  race.autoDrive = keepAutoDrive;
  race.state = 'countdown';
  race.countdownT = 3.2;
  race.countdownBeep = 4;
}

// Advance the league to its next race: new track, same league state and
// upgrades, fresh karts. Called from the season screen.
export function nextLeagueRace(race) {
  const league = race.league;
  league.raceIndex += 1;
  league.awarded = false;
  race.options = {
    ...race.options,
    trackIndex: league.trackOrder[league.raceIndex],
    upgrades: { ...league.upgrades },
    league,
  };
  resetRace(race);
}

// Back to the title menu (from the champion screen).
export function backToMenu(race) {
  const keepAudio = race.audio;
  const keepAutoDrive = race.autoDrive;
  const keepMenuSel = race.menuSel;
  const fresh = makeRace(race.seed, {
    trackIndex: 0,
    difficulty: 1,
    mode: 'single',
    league: null,
  });
  Object.keys(fresh).forEach((key) => {
    race[key] = fresh[key];
  });
  race.audio = keepAudio;
  race.autoDrive = keepAutoDrive;
  race.menuSel = keepMenuSel;
  race.state = 'menu';
}

// Did the kart move forward across the given track sample this step?
// prev/cur are sample indices; forward motion means the sample number grows
// (wrapping past the start line). Driving backwards never counts.
function passedGate(prev, cur, gate) {
  const n = TRACK_SAMPLES;
  const delta = (cur - prev + n) % n;
  if (delta === 0 || delta > n / 2) return false;
  if (prev <= cur) return gate > prev && gate <= cur;
  return gate > prev || gate <= cur;
}

// Checkpoint + lap validation for one kart after its physics step.
// A lap only counts after all 16 gates were passed in order; cutting a
// corner skips gates, so the lap never validates.
function validateLap(kart, prevSample, raceTime) {
  if (kart.finished) return;
  // Next gate in order. checkpoint runs 1..15 for gates 1..15, then 16
  // means "all gates passed, waiting for the start line". It never wraps
  // with a modulo: a lap only counts after every gate in order.
  if (kart.checkpoint < CHECKPOINT_COUNT) {
    const expectedGate = CHECKPOINT_SAMPLES[kart.checkpoint];
    if (passedGate(prevSample, kart.sample, expectedGate)) {
      kart.checkpoint += 1;
    }
  }
  if (kart.checkpoint === CHECKPOINT_COUNT) {
    const lineGate = CHECKPOINT_SAMPLES[0];
    if (passedGate(prevSample, kart.sample, lineGate)) {
      const lapTime = raceTime - kart.lapStartTime;
      kart.lapTimes.push(lapTime);
      if (kart.bestLap === 0 || lapTime < kart.bestLap) kart.bestLap = lapTime;
      kart.lap += 1;
      kart.lapStartTime = raceTime;
      kart.checkpoint = 1;
      if (kart.lap >= LAP_COUNT) {
        kart.finished = true;
        kart.finishTime = raceTime;
      }
    }
  }
}

// Standings: finished karts first (by finish time), then by progress.
export function standings(race) {
  return race.karts.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}

export function playerPosition(race) {
  return standings(race).indexOf(race.player) + 1;
}

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  const whole = Math.floor(s);
  const ms = Math.floor((s - whole) * 1000);
  return `${String(m).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
export { formatTime };

function checkBoostPads(race, kart) {
  if (kart.padCooldown > 0) return;
  for (const pad of BOOST_PADS) {
    const dx = kart.x - pad.x;
    const dy = kart.y - pad.y;
    if (dx * dx + dy * dy < 42 * 42) {
      kart.boostTime = Math.max(kart.boostTime, PHYSICS.padBoostTime);
      kart.padCooldown = 1.6;
      if (kart.isPlayer) playBoostWhoosh(race.audio);
      const backX = kart.x - Math.cos(kart.angle) * 18;
      const backY = kart.y - Math.sin(kart.angle) * 18;
      spawnBoostFlame(
        race.particles,
        backX,
        elevationAt(kart.sample) + 1,
        -backY,
        kart.angle,
      );
      break;
    }
  }
}

function spawnKartEffects(race, kart, dt) {
  if (kart.drifting && Math.abs(kart.speed) > 150) {
    kart.smokeTimer -= dt;
    if (kart.smokeTimer <= 0) {
      kart.smokeTimer = 0.03;
      const backX = kart.x - Math.cos(kart.angle) * 14;
      const backY = kart.y - Math.sin(kart.angle) * 14;
      // Plan velocity (-cos, -sin) * 40 becomes world (-cos, 0, +sin) * 40.
      spawnDriftSmoke(
        race.particles,
        backX,
        elevationAt(kart.sample) + 0.8,
        -backY,
        -Math.cos(kart.angle) * 40,
        0,
        Math.sin(kart.angle) * 40,
        kart.color,
      );
    }
  }
  if (kart.boosting && Math.abs(kart.speed) > 200) {
    const backX = kart.x - Math.cos(kart.angle) * 18;
    const backY = kart.y - Math.sin(kart.angle) * 18;
    spawnBoostFlame(
      race.particles,
      backX,
      elevationAt(kart.sample) + 1,
      -backY,
      kart.angle,
    );
  }
  if (kart.wallHit > 0.25 && Math.abs(kart.speed) > 140) {
    spawnWallSparks(
      race.particles,
      kart.x,
      elevationAt(kart.sample) + 1.5,
      -kart.y,
      kart.angle,
    );
    if (kart.isPlayer) playScrape(race.audio);
    if (kart.isPlayer) race.shake = Math.max(race.shake, 5);
  }
}

function stepRacing(race, input, dt) {
  race.raceTime += dt;
  race.wind = windAt(race.raceTime);
  const player = race.player;
  for (const kart of race.karts) {
    kart.rubberBand = kart.isPlayer
      ? 1
      : rubberBandFor(kart, player.progress, race.difficulty);
  }
  for (const kart of race.karts) {
    if (kart.finished) continue;
    const prevSample = kart.sample;
    const prevLap = kart.lap;
    let kartInput;
    if (kart.isPlayer && !race.autoDrive) {
      kartInput = drivingInput(input);
    } else {
      const driver = race.drivers[kart.id];
      kartInput = aiInput(driver, race.raceTime, player.progress, race.karts);
    }
    const wasBoosting = kart.boosting;
    stepKart(kart, kartInput, dt, race.wind);
    if (kart.boosting && !wasBoosting && kart.isPlayer) playBoostWhoosh(race.audio);
    validateLap(kart, prevSample, race.raceTime);
    // The player crossed the start line: the boost pads shift to the
    // next lap's seeded layout (B8). The renderer watches padVersion.
    if (kart.isPlayer && kart.lap !== prevLap && kart.lap < race.laps) {
      applyPadLayout(race.padLayouts[kart.lap]);
      race.padVersion += 1;
    }
    checkBoostPads(race, kart);
    spawnKartEffects(race, kart, dt);
  }
  collideKarts(race.karts);
  // Speed lines for the player at very high speed.
  if (Math.abs(player.speed) > 480 && race.frame % 6 === 0) {
    const side = race.frame % 12 === 0 ? 1 : -1;
    const px = player.x + Math.cos(player.angle + side * 1.2) * 260;
    const py = player.y + Math.sin(player.angle + side * 1.2) * 260;
    spawnSpeedLine(
      race.particles,
      px,
      elevationAt(player.sample) + 2,
      -py,
      player.angle,
      46,
    );
  }
  if (race.shake > 0) race.shake = Math.max(0, race.shake - dt * 22);
  if (race.messageT > 0) race.messageT -= dt;
  stepParticles(race.particles, dt);
  updateEngineSound(
    race.audio,
    Math.abs(player.speed) / PHYSICS.boostMaxSpeed,
    player.boosting,
  );

  // Player finished: results after a short beat so the finish registers.
  // resultsAt is armed once — re-arming it every step would delay the
  // results screen forever.
  if (player.finished && race.resultsAt === 0) {
    race.resultsAt = race.raceTime + 1.2;
  }
  if (player.finished && race.raceTime >= race.resultsAt && race.resultsAt > 0) {
    race.state = 'results';
    race.resultsAt = 0;
    stopEngineSound(race.audio);
    if (!race.fanfarePlayed && playerPosition(race) <= 3) {
      playFanfare(race.audio);
      race.fanfarePlayed = true;
    }
    // League: award points + credits once, and unlock the next track.
    if (race.mode === 'league' && race.league && !race.league.awarded) {
      race.resultsData = awardRace(race.league, standings(race));
      if (race.league.raceIndex === 0) race.unlocks = unlockTrack(race.unlocks, 1);
      if (race.league.raceIndex === 1) race.unlocks = unlockTrack(race.unlocks, 2);
    }
  }
}

export function stepRace(race, input, dt) {
  race.frame += 1;
  if (wasPressed(input, 'KeyM')) {
    ensureAudio(race.audio);
    const muted = toggleMute(race.audio);
    race.message = muted ? 'SOUND OFF' : 'SOUND ON';
    race.messageT = 1.2;
  }
  if (race.state === 'menu') {
    // The menu itself never starts the race: main.js owns the menu keys
    // (M/T/D to choose, Enter/Space/click to start) so an option key can
    // never double as a start. The race just idles its particles here.
    stepParticles(race.particles, dt);
    return;
  }
  if (race.state === 'countdown') {
    const prev = Math.ceil(race.countdownT);
    race.countdownT -= dt;
    const now = Math.ceil(race.countdownT);
    if (now !== prev && now >= 1 && now <= 3) {
      playCountdownBeep(race.audio, false);
    }
    if (race.countdownT <= 0) {
      race.state = 'racing';
      race.raceTime = 0;
      for (const kart of race.karts) kart.lapStartTime = 0;
      playCountdownBeep(race.audio, true);
      race.message = 'GO!';
      race.messageT = 1.0;
    }
    stepParticles(race.particles, dt);
    return;
  }
  if (race.state === 'paused') {
    if (wasPressed(input, 'KeyP') || wasPressed(input, 'Escape')) {
      race.state = race.prevState;
      playClick(race.audio);
    }
    if (wasPressed(input, 'KeyR')) resetRace(race);
    return;
  }
  if (race.state === 'racing') {
    if (wasPressed(input, 'KeyP') || wasPressed(input, 'Escape')) {
      race.prevState = 'racing';
      race.state = 'paused';
      stopEngineSound(race.audio);
      playClick(race.audio);
      return;
    }
    if (wasPressed(input, 'KeyR')) {
      resetRace(race);
      return;
    }
    stepRacing(race, input, dt);
    return;
  }
  if (race.state === 'results') {
    stepParticles(race.particles, dt);
    if (!race.confettiDone && playerPosition(race) <= 3) {
      race.confettiDone = true;
      const colors = race.karts.map((k) => k.color);
      spawnConfetti(
        race.particles,
        race.player.x,
        elevationAt(race.player.sample) + 6,
        -race.player.y,
        colors,
      );
    }
    if (wasPressed(input, 'KeyR') || wasPressed(input, 'Enter')) {
      if (race.mode === 'league' && race.league) {
        // Season over after race 3, otherwise the season screen.
        race.state = race.league.raceIndex >= 2 ? 'champion' : 'season';
        playClick(race.audio);
      } else {
        resetRace(race);
      }
    }
    return;
  }
  if (race.state === 'season') {
    stepParticles(race.particles, dt);
    // Shop keys: 1/2/3 buy one level of speed/handling/boost.
    if (wasPressed(input, 'Digit1')) buyUpgrade(race.league, 'speed');
    if (wasPressed(input, 'Digit2')) buyUpgrade(race.league, 'handling');
    if (wasPressed(input, 'Digit3')) buyUpgrade(race.league, 'boost');
    if (wasPressed(input, 'Enter')) {
      playClick(race.audio);
      nextLeagueRace(race);
    }
    return;
  }
  if (race.state === 'champion') {
    stepParticles(race.particles, dt);
    if (wasPressed(input, 'KeyR') || wasPressed(input, 'Enter')) {
      playClick(race.audio);
      backToMenu(race);
    }
    return;
  }
}

// Re-export league helpers the HUD needs, so it imports from one place.
export { POINTS_TABLE, makeLeague, championIndex };
