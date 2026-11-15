// NEON RUSH — 3D particles.
// Drift smoke, boost flames, wall sparks, speed lines, and winner confetti.
// Particles live in 3D world space (x, up, z — the same space the renderer
// uses), are spawned only from deterministic game events, and move with
// plain fixed-step integration, so a screenshot taken at a fixed race time
// always looks the same. Visual only: they never affect physics.

export function makeParticles() {
  return { list: [] };
}

function spawn(store, kind, x, y, z, vx, vy, vz, life, size, color) {
  if (store.list.length > 420) store.list.shift();
  store.list.push({
    kind,
    x,
    y,
    z,
    vx,
    vy,
    vz,
    life,
    maxLife: life,
    size,
    color,
  });
}

// Puffy smoke trailing a drifting kart's rear wheels. y is world height.
export function spawnDriftSmoke(store, x, y, z, vx, vy, vz, color) {
  spawn(store, 'smoke', x, y, z, vx * 0.25, vy * 0.25 + 6, vz * 0.25, 0.55, 9, color);
}

// Hot flame cone behind a boosting kart. angle is the kart's plan heading;
// the flame flies backwards along it, in world space.
export function spawnBoostFlame(store, x, y, z, angle) {
  const wobble = (store.list.length % 7 - 3) * 0.02;
  const dir = angle + Math.PI + wobble;
  const speed = 260;
  // World space: plan x -> x, plan y -> -z.
  spawn(
    store,
    'flame',
    x,
    y,
    z,
    Math.cos(dir) * speed,
    4,
    -Math.sin(dir) * speed,
    0.28,
    7,
    '#ff9a2e',
  );
}

// Bright sparks when a kart scrapes a wall.
export function spawnWallSparks(store, x, y, z, angle) {
  for (let i = 0; i < 6; i += 1) {
    const a = angle + (i - 2.5) * 0.5;
    const speed = 180 + i * 30;
    spawn(
      store,
      'spark',
      x,
      y,
      z,
      Math.cos(a) * speed,
      60 + i * 12,
      -Math.sin(a) * speed,
      0.32,
      2.5,
      i % 2 === 0 ? '#ffe66d' : '#ff5e78',
    );
  }
}

// A single speed line streaking past the camera at high speed.
export function spawnSpeedLine(store, x, y, z, angle, length) {
  spawn(store, 'line', x, y, z, Math.cos(angle) * 900, 0, -Math.sin(angle) * 900, 0.22, length, '#aefcff');
}

// Confetti burst for the race winner on the results screen.
export function spawnConfetti(store, x, y, z, colors) {
  for (let i = 0; i < 40; i += 1) {
    const a = (i / 40) * Math.PI * 2;
    const speed = 120 + (i % 5) * 45;
    spawn(
      store,
      'confetti',
      x,
      y,
      z,
      Math.cos(a) * speed,
      140 + (i % 3) * 40,
      Math.sin(a) * speed,
      1.4,
      4,
      colors[i % colors.length],
    );
  }
}

export function stepParticles(store, dt) {
  for (let i = store.list.length - 1; i >= 0; i -= 1) {
    const p = store.list[i];
    p.life -= dt;
    if (p.life <= 0) {
      store.list.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    if (p.kind === 'smoke') {
      p.vx *= 1 - 2.2 * dt;
      p.vy *= 1 - 1.2 * dt;
      p.vz *= 1 - 2.2 * dt;
      p.size += 14 * dt;
      if (p.y < 0.5) p.y = 0.5;
    } else if (p.kind === 'spark') {
      p.vy -= 300 * dt;
    } else if (p.kind === 'confetti') {
      p.vy -= 240 * dt;
      p.vx *= 1 - 0.8 * dt;
      p.vz *= 1 - 0.8 * dt;
    }
  }
}

export function clearParticles(store) {
  store.list.length = 0;
}
