// NEON RUSH — boot + fixed-timestep loop.
// The loop runs physics at exactly 120 Hz no matter the display refresh:
// real time is accumulated, whole steps are consumed, and the 3D renderer
// reads the latest state. The only clock the game logic sees is accumulated
// step time, so the race is deterministic from its seed. Query params:
// ?shot=title|race|drift|results for the screenshot scenes (camera snaps,
// no smoothing, so a shot is a fixed render), ?autodrive=1 to let the AI
// drive the player kart (used by the headless race test).

import { makeRace, stepRace, RACE_SEED, standings, playerPosition } from './race.js';
import { TRACK_POINTS } from './track.js';
import { makeInput, attachInput } from './input.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { raceForShot } from './shots.js';

const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;

const canvas = document.getElementById('game');
const input = makeInput();
attachInput(input, canvas);

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const autoDrive = params.get('autodrive') === '1';

let race;
if (shot) {
  race = raceForShot(shot);
} else {
  race = makeRace(RACE_SEED);
}
race.autoDrive = autoDrive;

const renderer3d = createRenderer(canvas);
renderer3d.setShotMode(Boolean(shot));
const hud = createHud();

// Test hooks for the headless harness: read-only snapshots of race state.
// The game never reads these back, so they cannot change how it plays.
window.NEON = {
  race,
  input,
  state: () => race.state,
  standings: () =>
    standings(race).map((k) => ({
      name: k.name,
      lap: k.lap,
      checkpoint: k.checkpoint,
      progress: Math.round(k.progress),
      finished: k.finished,
      finishTime: k.finishTime,
      bestLap: k.bestLap,
    })),
  playerPosition: () => playerPosition(race),
  raceTime: () => race.raceTime,
  // Advance the simulation by N fixed steps without rendering. The test
  // harness uses this to run a whole race quickly and deterministically.
  advance: (steps) => {
    for (let i = 0; i < steps; i += 1) stepRace(race, input, STEP);
    return window.NEON.standings();
  },
  // Teleport the player kart to a track sample (anti-cut test): the lap
  // validator must refuse to count a lap from a jump that skips gates.
  teleportPlayer: (sample) => {
    const p = TRACK_POINTS[sample];
    const player = race.player;
    player.x = p.x;
    player.y = p.y;
    player.angle = p.angle;
    player.sample = sample;
    player.lateral = 0;
    player.speed = 300;
    return { x: player.x, y: player.y, sample: player.sample };
  },
};

function resize() {
  renderer3d.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

let accumulator = 0;
let lastNow = performance.now();

function frame(now) {
  const elapsed = Math.min(0.25, (now - lastNow) / 1000);
  lastNow = now;
  // Shot mode freezes the simulation: the scene is a fixed render, so the
  // clock, particles, and blink states never drift with wall time.
  if (!shot) {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      stepRace(race, input, STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
  }
  renderer3d.render(race);
  hud.update(race);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
