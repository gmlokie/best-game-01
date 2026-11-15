// NEON RUSH — Neon League: championship season, credits, shop, difficulty.
// Pure data + arithmetic: no DOM, no clocks, no randomness here. The race
// module owns the league state; this file only defines the tables and the
// operations on them, so the season is fully reproducible from its seed.

export const POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4];
export const CREDITS_TABLE = [500, 400, 320, 250, 200, 150, 100, 60];
export const BEST_LAP_BONUS = 50;

export const DIFFICULTIES = [
  {
    id: 'rookie',
    name: 'ROOKIE',
    tagline: 'Gentle rivals, strong catch-up',
    ai: {
      topSpeed: [0.88, 0.95],
      corner: [0.88, 0.97],
      accel: [0.9, 0.98],
    },
    rubberMax: 1.12,
    rubberMin: 0.95,
  },
  {
    id: 'pro',
    name: 'PRO',
    tagline: 'The standard field',
    ai: {
      topSpeed: [0.93, 1.0],
      corner: [0.9, 1.04],
      accel: [0.94, 1.02],
    },
    rubberMax: 1.09,
    rubberMin: 0.93,
  },
  {
    id: 'legend',
    name: 'LEGEND',
    tagline: 'Faster rivals, no mercy',
    ai: {
      topSpeed: [0.97, 1.04],
      corner: [0.95, 1.08],
      accel: [0.97, 1.04],
    },
    rubberMax: 1.05,
    rubberMin: 0.96,
  },
];

// Shop: three upgrade lines, three levels each. Costs are per level.
// Speed raises top speed, Handling raises steering rate, Boost raises
// boost top speed and boost acceleration. All three apply to the player
// kart only, as multipliers on the base skill.
export const UPGRADE_LINES = [
  { id: 'speed', name: 'TOP SPEED', desc: '+4% top speed / level', costs: [200, 350, 500] },
  { id: 'handling', name: 'HANDLING', desc: '+6% steering rate / level', costs: [200, 350, 500] },
  { id: 'boost', name: 'BOOST', desc: '+7% boost speed & accel / level', costs: [200, 350, 500] },
];

export function makeLeague(difficultyIndex) {
  return {
    raceIndex: 0, // 0..2, one race per track in order
    trackOrder: [0, 1, 2],
    difficulty: difficultyIndex,
    points: [0, 0, 0, 0, 0, 0, 0, 0], // per kart id
    wins: [0, 0, 0, 0, 0, 0, 0, 0],
    credits: 0,
    upgrades: { speed: 0, handling: 0, boost: 0 },
    awarded: false, // points/credits for the current race, awarded once
  };
}

// Award championship points + credits for one finished race.
// standings: karts sorted best-first (race.standings). Returns what the
// player earned: { position, points, credits, bestLapBonus }.
export function awardRace(league, standings) {
  const pos = standings.findIndex((k) => k.isPlayer) + 1;
  const points = POINTS_TABLE[pos - 1] || 0;
  let credits = CREDITS_TABLE[pos - 1] || 0;
  const player = standings.find((k) => k.isPlayer);
  let bestLapBonus = 0;
  const bestLap = Math.min(...standings.map((k) => k.bestLap || Infinity));
  if (player.bestLap > 0 && player.bestLap <= bestLap) {
    bestLapBonus = BEST_LAP_BONUS;
    credits += BEST_LAP_BONUS;
  }
  standings.forEach((kart, i) => {
    league.points[kart.id] += POINTS_TABLE[i] || 0;
    if (i === 0) league.wins[kart.id] += 1;
  });
  league.credits += credits;
  league.awarded = true;
  return { position: pos, points, credits, bestLapBonus };
}

// Buy one level of an upgrade line. Returns true on success.
export function buyUpgrade(league, lineId) {
  const line = UPGRADE_LINES.find((l) => l.id === lineId);
  if (!line) return false;
  const level = league.upgrades[lineId] || 0;
  if (level >= line.costs.length) return false;
  const cost = line.costs[level];
  if (league.credits < cost) return false;
  league.credits -= cost;
  league.upgrades[lineId] = level + 1;
  return true;
}

// Apply the league upgrades to a base skill object (player kart).
export function applyUpgrades(skill, upgrades) {
  return {
    ...skill,
    topSpeed: skill.topSpeed * (1 + 0.04 * (upgrades.speed || 0)),
    handling: (skill.handling || 1) * (1 + 0.06 * (upgrades.handling || 0)),
    boost: (skill.boost || 1) * (1 + 0.07 * (upgrades.boost || 0)),
  };
}

// Season champion: most points; ties break by most wins, then by the best
// finish in the last race (lowest last-race position wins).
export function championIndex(league, lastStandings) {
  let best = 0;
  for (let i = 1; i < league.points.length; i += 1) {
    if (league.points[i] > league.points[best]) best = i;
    else if (league.points[i] === league.points[best]) {
      if (league.wins[i] > league.wins[best]) best = i;
      else if (league.wins[i] === league.wins[best] && lastStandings) {
        const a = lastStandings.findIndex((k) => k.id === i);
        const b = lastStandings.findIndex((k) => k.id === best);
        if (a !== -1 && b !== -1 && a < b) best = i;
      }
    }
  }
  return best;
}

// --- Track unlocks (menu only, never read by the race itself) ---
// Track 2 unlocks by finishing League race 1, track 3 by finishing race 2.
// Stored in localStorage so the menu remembers; the deterministic race
// path never touches it.
const UNLOCK_KEY = 'neon-rush-unlocks-v1';

export function loadUnlocks() {
  try {
    const raw = window.localStorage.getItem(UNLOCK_KEY);
    if (!raw) return [true, false, false];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.tracks)) return [true, false, false];
    return [true, !!parsed.tracks[1], !!parsed.tracks[2]];
  } catch {
    return [true, false, false];
  }
}

export function saveUnlocks(unlocks) {
  try {
    window.localStorage.setItem(UNLOCK_KEY, JSON.stringify({ tracks: unlocks }));
  } catch {
    // Storage unavailable (private mode, sandbox) — unlocks just don't
    // persist. The game plays on regardless.
  }
}

export function unlockTrack(unlocks, index) {
  const next = unlocks.slice();
  if (index >= 0 && index < next.length) next[index] = true;
  saveUnlocks(next);
  return next;
}
