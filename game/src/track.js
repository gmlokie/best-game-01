// NEON RUSH — the circuits.
// Three closed loops, each built from a Catmull-Rom spline through
// hand-placed control points. The spline is sampled once into a fixed
// table; every other system (physics, AI, lap validation, rendering,
// minimap) reads that table, so a track never changes between runs.
// Coordinates are world pixels.
//
// One track is ACTIVE at a time: loadTrack(i) rebuilds the module's
// tables (TRACK_POINTS, TRACK_LENGTH, BOOST_PADS, CHECKPOINT_SAMPLES,
// LAP_COUNT). All other modules read those tables at call time, so a
// switch takes effect the next race. trackVersion bumps on every switch
// so the renderer can rebuild its track meshes.

export const TRACK_SAMPLES = 480;
export const TRACK_HALF_WIDTH = 62;
export const CHECKPOINT_COUNT = 16;

// Scale a control-point list about a centre point.
function scalePoints(points, factor, cx, cy) {
  return points.map((p) => ({
    x: cx + (p.x - cx) * factor,
    y: cy + (p.y - cy) * factor,
    h: p.h,
  }));
}

// --- Track 1: NEON LOOP (the original circuit, scaled 2x) ---
// Twelve points, so the 480 samples split evenly (40 per segment).
// Roughly a rounded rectangle with a kinked inner section so the corners
// are not all the same. h is the track elevation at that point (world
// units, visual only — the 2D physics below never sees it, so it cannot
// change how a race plays out).
const NEON_LOOP_POINTS = scalePoints(
  [
    { x: 420, y: 300, h: 0 },
    { x: 900, y: 210, h: 7 },
    { x: 1450, y: 250, h: 15 },
    { x: 1920, y: 360, h: 9 },
    { x: 2080, y: 720, h: 1 },
    { x: 1930, y: 1060, h: -5 },
    { x: 1560, y: 1440, h: 8 },
    { x: 1080, y: 1330, h: 17 },
    { x: 700, y: 1430, h: 6 },
    { x: 360, y: 1240, h: -2 },
    { x: 250, y: 880, h: -7 },
    { x: 310, y: 540, h: 3 },
  ],
  2.0,
  1165,
  825,
);

// --- Track 2: SUNSET BAY (fast, sweeping) ---
// Long straights, wide sweepers, one hairpin at the top. The inner S
// (points 10-12) dips inside the loop without crossing it. Scaled 1.35x
// so a lap runs ~25 s and the 5-lap race ~2 minutes.
const SUNSET_BAY_POINTS = scalePoints(
  [
    { x: 300, y: 200, h: 0 },
    { x: 1100, y: 120, h: 6 },
    { x: 1900, y: 180, h: 12 },
    { x: 2400, y: 420, h: 8 },
    { x: 2600, y: 900, h: 2 },
    { x: 2350, y: 1350, h: -4 },
    { x: 1900, y: 1650, h: 6 },
    { x: 1400, y: 1750, h: 14 },
    { x: 950, y: 1600, h: 8 },
    { x: 700, y: 1250, h: 0 },
    { x: 950, y: 950, h: -6 },
    { x: 650, y: 650, h: 4 },
    { x: 250, y: 700, h: -2 },
    { x: 100, y: 420, h: 3 },
  ],
  1.35,
  1165,
  825,
);

// --- Track 3: VOID CIRCUIT (technical) ---
// Tighter corners and bigger elevation swings than the other two, so the
// racing line matters more. Six laps keeps the race at ~2 minutes.
// The bottom edge flows east (no doubling back) so the spline never cusps.
const VOID_CIRCUIT_POINTS = scalePoints(
  [
    { x: 800, y: 300, h: 0 },
    { x: 1000, y: 160, h: 8 },
    { x: 1650, y: 260, h: 14 },
    { x: 2150, y: 520, h: 6 },
    { x: 2400, y: 950, h: -4 },
    { x: 2150, y: 1350, h: 8 },
    { x: 1650, y: 1580, h: 16 },
    { x: 1150, y: 1420, h: 6 },
    { x: 850, y: 1680, h: 10 },
    { x: 450, y: 1560, h: 2 },
    { x: 280, y: 1180, h: -6 },
    { x: 520, y: 920, h: 4 },
    { x: 380, y: 640, h: -2 },
    { x: 500, y: 400, h: 6 },
  ],
  1.3,
  1165,
  825,
);

export const TRACKS = [
  {
    id: 'neon-loop',
    name: 'NEON LOOP',
    tagline: 'The original circuit — balanced, flowing, 5 laps',
    laps: 5,
    controlPoints: NEON_LOOP_POINTS,
    padSamples: [55, 145, 235, 325, 415],
  },
  {
    id: 'sunset-bay',
    name: 'SUNSET BAY',
    tagline: 'Fast sweepers and one hairpin — 5 laps',
    laps: 5,
    controlPoints: SUNSET_BAY_POINTS,
    padSamples: [40, 130, 220, 310, 400],
  },
  {
    id: 'void-circuit',
    name: 'VOID CIRCUIT',
    tagline: 'Technical, twisty, big elevation — 6 laps',
    laps: 6,
    controlPoints: VOID_CIRCUIT_POINTS,
    padSamples: [60, 150, 240, 330, 420],
  },
];

export let activeTrackIndex = 0;
// Bumps on every loadTrack call so the renderer/HUD can rebuild.
export let trackVersion = 0;

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const blend = (a, b, c, d) =>
    0.5 *
    (2 * b +
      (-a + c) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (-a + 3 * b - 3 * c + d) * t3);
  return {
    x: blend(p0.x, p1.x, p2.x, p3.x),
    y: blend(p0.y, p1.y, p2.y, p3.y),
    h: blend(p0.h, p1.h, p2.h, p3.h),
  };
}

// Sample one track definition into a dense table of points with tangents
// and cumulative distance. Index 0 is the start/finish line.
// The table has EXACTLY TRACK_SAMPLES points: the samples are spread
// across the segments as evenly as possible (the first `rem` segments get
// one extra sample). A naive perSegment = TRACK_SAMPLES / n loop pushes
// ceil() points per segment and overshoots when 480 is not divisible by
// the control-point count — that silently broke lap validation on the
// 14-point tracks (490 points vs a 480 modulus: the sample wrapped
// mid-lap and the start-line gate never fired).
export function buildTrack(def) {
  const controlPoints = def.controlPoints;
  const points = [];
  const n = controlPoints.length;
  const base = Math.floor(TRACK_SAMPLES / n);
  const rem = TRACK_SAMPLES - base * n;
  for (let s = 0; s < n; s += 1) {
    const p0 = controlPoints[(s - 1 + n) % n];
    const p1 = controlPoints[s];
    const p2 = controlPoints[(s + 1) % n];
    const p3 = controlPoints[(s + 2) % n];
    const count = base + (s < rem ? 1 : 0);
    for (let k = 0; k < count; k += 1) {
      points.push(catmullRom(p0, p1, p2, p3, k / count));
    }
  }
  // Tangent + cumulative arc length per sample.
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    a.tx = dx / len;
    a.ty = dy / len;
    a.angle = Math.atan2(dy, dx);
    a.dist = total;
    total += len;
  }
  // Banking: the track surface rolls into each corner, proportional to the
  // signed curvature there. Visual only — physics never reads it.
  for (let i = 0; i < points.length; i += 1) {
    const m = points.length;
    const a0 = points[(i - 10 + m) % m].angle;
    const a1 = points[(i + 10) % m].angle;
    let turn = a1 - a0;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const clamped = Math.max(-0.3, Math.min(0.3, turn * 1.4));
    points[i].bank = clamped;
  }
  return { points, length: total };
}

// Active-track tables. Rebuilt by loadTrack; every other module reads
// these at call time, never at import time.
export let TRACK_POINTS = [];
export let TRACK_LENGTH = 0;
export let LAP_COUNT = 5;
export let BOOST_PADS = [];
export let CHECKPOINT_SAMPLES = [];

export function loadTrack(index) {
  const i = Math.max(0, Math.min(TRACKS.length - 1, index | 0));
  // Same track already loaded: nothing to rebuild, version unchanged.
  if (i === activeTrackIndex && TRACK_POINTS.length > 0) return TRACKS[i];
  const def = TRACKS[i];
  const built = buildTrack(def);
  TRACK_POINTS = built.points;
  TRACK_LENGTH = built.length;
  LAP_COUNT = def.laps;
  BOOST_PADS = def.padSamples.map((sample) => ({
    sample,
    x: TRACK_POINTS[sample].x,
    y: TRACK_POINTS[sample].y,
    angle: TRACK_POINTS[sample].angle,
    cooldown: 0,
  }));
  CHECKPOINT_SAMPLES = [];
  for (let c = 0; c < CHECKPOINT_COUNT; c += 1) {
    CHECKPOINT_SAMPLES.push(Math.floor((c * TRACK_SAMPLES) / CHECKPOINT_COUNT));
  }
  activeTrackIndex = i;
  trackVersion += 1;
  return def;
}

// The default track, so a plain import already has a circuit loaded.
loadTrack(0);

// Boost-pad layouts, one per lap: the pads shift to a new seeded shuffle
// of the track's pad slots every lap (B8 — dynamic variation). Pure: the
// layouts depend only on the race seed, so two runs with the same seed
// always see the same pads on the same laps.
export function padLayoutsForRace(seed, laps) {
  const layouts = [];
  const slots = TRACKS[activeTrackIndex].padSamples;
  for (let lap = 0; lap < laps; lap += 1) {
    const rngState = { s: (seed ^ Math.imul(lap + 1, 7919)) >>> 0 };
    const next = () => {
      rngState.s = (rngState.s + 0x6d2b79f5) >>> 0;
      let t = rngState.s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = slots.slice();
    for (let k = order.length - 1; k > 0; k -= 1) {
      const j = Math.floor(next() * (k + 1));
      const tmp = order[k];
      order[k] = order[j];
      order[j] = tmp;
    }
    layouts.push(order);
  }
  return layouts;
}

// Apply one lap's pad layout to the active BOOST_PADS table (in place, so
// every reader sees the new positions at once).
export function applyPadLayout(samples) {
  for (let i = 0; i < BOOST_PADS.length && i < samples.length; i += 1) {
    const sample = samples[i];
    BOOST_PADS[i].sample = sample;
    BOOST_PADS[i].x = TRACK_POINTS[sample].x;
    BOOST_PADS[i].y = TRACK_POINTS[sample].y;
    BOOST_PADS[i].angle = TRACK_POINTS[sample].angle;
  }
}

// Nearest sample index to a world position. Brute force over 480 samples is
// cheap at 120 Hz for 8 karts; the search starts from a hint index and walks
// outward, so it stays fast and exact.
export function nearestSample(x, y, hint) {
  const n = TRACK_POINTS.length;
  let best = hint % n;
  let bestDist = Infinity;
  // Coarse sweep every 8th sample, then refine around the winner.
  for (let i = 0; i < n; i += 8) {
    const p = TRACK_POINTS[i];
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  for (let off = -8; off <= 8; off += 1) {
    const i = (best + off + n) % n;
    const p = TRACK_POINTS[i];
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return { index: best, dist: Math.sqrt(bestDist) };
}

// Closest point on the centreline to a world position, as a projection onto
// the nearest track segment (not just the nearest sample). Projecting onto
// a sample point would erase along-track progress every step a kart scrapes
// the wall; projecting onto the segment keeps it. Returns the projected
// point, its tangent, the signed lateral offset, and a fractional sample.
export function closestPoint(x, y, hint) {
  const near = nearestSample(x, y, hint);
  const n = TRACK_POINTS.length;
  let best = null;
  const starts = [(near.index - 1 + n) % n, near.index];
  for (const a of starts) {
    const b = (a + 1) % n;
    const pa = TRACK_POINTS[a];
    const pb = TRACK_POINTS[b];
    const abx = pb.x - pa.x;
    const aby = pb.y - pa.y;
    const len = Math.hypot(abx, aby) || 1;
    const len2 = len * len;
    let t = ((x - pa.x) * abx + (y - pa.y) * aby) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    const cx = pa.x + abx * t;
    const cy = pa.y + aby * t;
    const d = Math.hypot(x - cx, y - cy);
    if (!best || d < best.dist) {
      const tx = abx / len;
      const ty = aby / len;
      best = {
        x: cx,
        y: cy,
        tx,
        ty,
        angle: Math.atan2(ty, tx),
        dist: d,
        lateral: (x - cx) * -ty + (y - cy) * tx,
        sample: a + t,
      };
    }
  }
  return best;
}

// Signed lateral offset from the centreline at the nearest sample: positive
// is to the left of the direction of travel.
export function lateralOffset(x, y, sampleIndex) {
  const p = TRACK_POINTS[sampleIndex];
  const dx = x - p.x;
  const dy = y - p.y;
  return dx * -p.ty + dy * p.tx;
}

// Curvature ahead of a sample: angle change over the next few samples.
// Large values mean a tight corner is coming.
export function curvatureAhead(sampleIndex, lookahead) {
  const n = TRACK_POINTS.length;
  const a0 = TRACK_POINTS[sampleIndex].angle;
  const a1 = TRACK_POINTS[(sampleIndex + lookahead) % n].angle;
  let diff = a1 - a0;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return Math.abs(diff);
}

// Elevation (world height) at a fractional sample index, interpolated.
export function elevationAt(sampleFloat) {
  const n = TRACK_POINTS.length;
  const i = Math.floor(sampleFloat) % n;
  const j = (i + 1) % n;
  const f = sampleFloat - Math.floor(sampleFloat);
  return TRACK_POINTS[i].h * (1 - f) + TRACK_POINTS[j].h * f;
}

// Banking angle (radians) at a fractional sample index, interpolated.
export function bankAt(sampleFloat) {
  const n = TRACK_POINTS.length;
  const i = Math.floor(sampleFloat) % n;
  const j = (i + 1) % n;
  const f = sampleFloat - Math.floor(sampleFloat);
  return TRACK_POINTS[i].bank * (1 - f) + TRACK_POINTS[j].bank * f;
}

// World bounds of the whole track, for the camera and the minimap.
export function trackBounds() {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of TRACK_POINTS) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
