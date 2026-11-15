// NEON RUSH — deterministic screenshot scenes.
// ?shot=title|race|drift|results sets up one exact scene by SIMULATING a
// real race from the fixed seed with the AI driving the player kart —
// nothing here is hand-placed or fabricated. The lap times, race time,
// standings, and particles in a shot are whatever the real simulation
// produced at that moment, so a screenshot always shows honest gameplay.
// Times are fixed-step counts, never wall clocks, so the same query always
// paints the same frame.

import { makeRace, RACE_SEED, startCountdown, stepRace } from './race.js';
import { makeInput } from './input.js';

const STEP = 1 / 120;

// Run the race forward with the AI driving the player until stopWhen
// returns true (or maxSteps elapse). Returns the steps consumed.
function simulateTo(race, stopWhen, maxSteps) {
  const input = makeInput();
  race.autoDrive = true;
  startCountdown(race);
  let steps = 0;
  while (steps < maxSteps && !stopWhen(race)) {
    stepRace(race, input, STEP);
    steps += 1;
  }
  return steps;
}

export function setupShot(race, shot) {
  if (shot === 'title') {
    race.state = 'menu';
    race.frame = 90; // menu blink mid-cycle, deterministic
    return race;
  }
  if (shot === 'race') {
    // Real race, 12 s after GO: lap 1, the pack still bunched.
    simulateTo(race, (r) => r.state === 'racing' && r.raceTime >= 12, 120 * 60);
    return race;
  }
  if (shot === 'drift') {
    // The first real drift with a charged boost meter, within 90 s of
    // racing. If no drift happens (it always does on lap 1's corners),
    // the scene freezes at the 90 s mark — still a real frame.
    simulateTo(
      race,
      (r) => r.state === 'racing' && r.player.drifting && r.player.boostMeter > 0.5,
      120 * 90,
    );
    return race;
  }
  if (shot === 'results') {
    // A whole real race to the finish, then a few steps so the results
    // screen settles (confetti spawns, the table fills in).
    simulateTo(race, (r) => r.state === 'results', 120 * 400);
    const input = makeInput();
    for (let i = 0; i < 72; i += 1) stepRace(race, input, STEP);
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
