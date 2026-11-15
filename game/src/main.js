// NEON RUSH — boot + fixed-timestep loop.
// The loop runs physics at exactly 120 Hz no matter the display refresh:
// real time is accumulated, whole steps are consumed, and the 3D renderer
// reads the latest state. The only clock the game logic sees is accumulated
// step time, so the race is deterministic from its seed. Query params:
// ?shot=title|race|drift|results for the screenshot scenes (real simulated
// play, frozen at a fixed moment — see shots.js), ?autodrive=1 to let the
// AI drive the player kart (used by the headless race test), ?track=0|1|2
// to open on a different circuit.

import { makeRace, stepRace, resetRace, RACE_SEED, standings, playerPosition, makeLeague } from './race.js';
import { TRACK_POINTS, trackVersion } from './track.js';
import { makeInput, attachInput, wasPressed } from './input.js';
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
const trackParam = params.get('track');
const trackIndex = trackParam === null ? 0 : Math.max(0, Math.min(2, Number(trackParam) | 0));

let race;
if (shot) {
  race = raceForShot(shot);
} else {
  race = makeRace(RACE_SEED, { trackIndex });
  race.menuSel.trackIndex = trackIndex;
}
race.autoDrive = autoDrive;

const renderer3d = createRenderer(canvas);
renderer3d.setShotMode(Boolean(shot));
const hud = createHud();

// Menu keys: M cycles mode, T cycles track (single mode, unlocked only),
// D cycles difficulty. Enter/Space starts the race with the current
// selection. Handled here, before stepRace, so an option key can never
// double as a start (the race module never starts from the menu itself).
function handleMenuInput() {
  const sel = race.menuSel;
  if (wasPressed(input, 'KeyM')) {
    sel.mode = sel.mode === 'single' ? 'league' : 'single';
  }
  if (wasPressed(input, 'KeyT') && sel.mode === 'single') {
    for (let k = 1; k <= 3; k += 1) {
      const next = (sel.trackIndex + k) % 3;
      if (race.unlocks[next]) {
        sel.trackIndex = next;
        break;
      }
    }
  }
  if (wasPressed(input, 'KeyD')) {
    sel.difficulty = (sel.difficulty + 1) % 3;
  }
  const start =
    wasPressed(input, 'Enter') || wasPressed(input, 'Space') || input.mouseClicked;
  if (start) {
    input.mouseClicked = false;
    const keepMenuSel = { ...sel };
    if (sel.mode === 'league') {
      const league = makeLeague(sel.difficulty);
      race.options = { trackIndex: 0, difficulty: sel.difficulty, mode: 'league', league };
    } else {
      race.options = {
        trackIndex: sel.trackIndex,
        difficulty: sel.difficulty,
        mode: 'single',
        league: null,
      };
    }
    resetRace(race);
    race.menuSel = keepMenuSel;
  }
}

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
  league: () => (race.league ? { ...race.league, points: race.league.points.slice() } : null),
  menuSel: () => ({ ...race.menuSel }),
  trackVersion: () => trackVersion,
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
let seenTrackVersion = trackVersion;

function frame(now) {
  const elapsed = Math.min(0.25, (now - lastNow) / 1000);
  lastNow = now;
  // Shot mode freezes the simulation: the scene is a fixed render, so the
  // clock, particles, and blink states never drift with wall time.
  if (!shot) {
    if (race.state === 'menu') handleMenuInput();
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      stepRace(race, input, STEP);
      accumulator -= STEP;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_FRAME) accumulator = 0;
    // The active track changed (league next race, or a menu start on a
    // different circuit): rebuild the track meshes from the new tables.
    if (trackVersion !== seenTrackVersion) {
      seenTrackVersion = trackVersion;
      renderer3d.rebuildTrack();
    }
  }
  renderer3d.render(race);
  hud.update(race);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
