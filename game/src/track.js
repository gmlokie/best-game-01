// NEON RUSH — the circuit.
// One closed loop built from a Catmull-Rom spline through hand-placed control
// points. The spline is sampled once into a fixed table; every other system
// (physics, AI, lap validation, rendering, minimap) reads that table, so the
// track never changes between runs. Coordinates are world pixels.

export const TRACK_SAMPLES = 480;
export const TRACK_HALF_WIDTH = 62;
export const CHECKPOINT_COUNT = 16;
export const LAP_COUNT = 3;

// Control points of the Neon Loop circuit. Twelve points, so the 480
// samples split evenly (40 per segment). Roughly a rounded rectangle with
// a kinked inner section so the corners are not all the same. h is the
// track elevation at that point (world units, visual only — the 2D physics
// below never sees it, so it cannot change how a race plays out).
const CONTROL_POINTS = [
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
];

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

// Sample the closed spline into a dense table of points with tangents and
// cumulative distance. Index 0 is the start/finish line.
function buildSamples() {
  const points = [];
  const n = CONTROL_POINTS.length;
  const perSegment = TRACK_SAMPLES / n;
  for (let s = 0; s < n; s += 1) {
    const p0 = CONTROL_POINTS[(s - 1 + n) % n];
    const p1 = CONTROL_POINTS[s];
    const p2 = CONTROL_POINTS[(s + 1) % n];
    const p3 = CONTROL_POINTS[(s + 2) % n];
    for (let k = 0; k < perSegment; k += 1) {
      points.push(catmullRom(p0, p1, p2, p3, k / perSegment));
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
    const n = points.length;
    const a0 = points[(i - 10 + n) % n].angle;
    const a1 = points[(i + 10) % n].angle;
    let turn = a1 - a0;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const clamped = Math.max(-0.3, Math.min(0.3, turn * 1.4));
    points[i].bank = clamped;
  }
  return { points, length: total };
}

const built = buildSamples();
export const TRACK_POINTS = built.points;
export const TRACK_LENGTH = built.length;

// Boost pads sit on the centreline at these sample indices, each one a short
// strip across the track. Driving over one fires a boost burst.
export const BOOST_PADS = [55, 145, 235, 325, 415].map((sample) => ({
  sample,
  x: TRACK_POINTS[sample].x,
  y: TRACK_POINTS[sample].y,
  angle: TRACK_POINTS[sample].angle,
  cooldown: 0,
}));

// Checkpoints: sample index of each gate, evenly spaced around the loop.
// Gate 0 is the start/finish line itself.
export const CHECKPOINT_SAMPLES = [];
for (let c = 0; c < CHECKPOINT_COUNT; c += 1) {
  CHECKPOINT_SAMPLES.push(Math.floor((c * TRACK_SAMPLES) / CHECKPOINT_COUNT));
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
