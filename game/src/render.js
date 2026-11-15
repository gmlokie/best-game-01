// NEON RUSH — three.js 3D renderer.
// A real 3D synthwave scene: perspective chase camera behind the player
// kart, a banked ribbon track with elevation, karts built from primitives,
// neon edge glow, sunset sky dome, fog, trackside pylons, arches and a
// city skyline, dynamic lighting with a modest shadow map, and 3D
// particles. Geometries and materials are shared and reused; the physics
// stays fixed-step and decoupled from rendering.
//
// Coordinate mapping: the 2D track plan (x, y) becomes world (x, up, -y),
// and a plan heading angle maps straight to rotation.y, so the 2D logic
// files never change.
//
// Track switching: everything that depends on the active track lives in
// one group, built by buildTrackGroup(). rebuildTrack() drops that group
// and builds a fresh one from the current track tables, so a league race
// on a new circuit reuses the same renderer, karts, sky, and lights.

import * as THREE from 'three';
import {
  TRACK_POINTS,
  TRACK_SAMPLES,
  TRACK_HALF_WIDTH,
  BOOST_PADS,
  elevationAt,
  bankAt,
} from './track.js';

const STEP = 1 / 120;
const SKY_TOP = new THREE.Color(0x1b0b3d);
const SKY_MID = new THREE.Color(0x8b2a6d);
const SKY_LOW = new THREE.Color(0xff7a3d);

// Scratch objects, reused every frame so rendering allocates nothing.
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');

function planToWorld(planX, planY, up) {
  return _v1.set(planX, up, -planY);
}

function makeGridTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0618';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(124, 92, 255, 0.38)';
  g.lineWidth = 2;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(56, 56);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCheckerTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i += 1) {
    g.fillStyle = i % 2 === 0 ? '#f5f0ff' : '#0a0618';
    g.fillRect(i * 16, 0, 16, 32);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0d0a1e';
  g.fillRect(0, 0, 128, 256);
  // Deterministic lit windows: a fixed checker-ish pattern, no randomness.
  for (let y = 8; y < 248; y += 16) {
    for (let x = 8; x < 120; x += 16) {
      const lit = (x * 7 + y * 13) % 5 < 2;
      g.fillStyle = lit ? '#ffd166' : '#241a3d';
      if ((x + y) % 32 === 0) g.fillStyle = '#22d3ee';
      g.fillRect(x, y, 9, 11);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Neon billboard texture: gradient + word, drawn once, reused by every
// billboard. The words cycle through a fixed list, so each board reads
// differently while sharing one texture.
function makeBillboardTexture(word) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, '#ff2e88');
  grad.addColorStop(0.5, '#7c5cff');
  grad.addColorStop(1, '#22d3ee');
  g.fillStyle = '#0a0618';
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 6);
  g.fillRect(0, 90, 256, 6);
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(word, 128, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// The sky: a huge inverted sphere with a vertical gradient shader — deep
// violet up top, magenta mid, sunset orange at the horizon.
function makeSky() {
  const geo = new THREE.SphereGeometry(3800, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: SKY_TOP },
      mid: { value: SKY_MID },
      low: { value: SKY_LOW },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top;
      uniform vec3 mid;
      uniform vec3 low;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = h > 0.12
          ? mix(mid, top, smoothstep(0.12, 0.65, h))
          : mix(low, mid, smoothstep(-0.08, 0.12, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

// The track ribbon: two vertices per sample, rolled by the banking angle,
// with the elevation baked in. One draw call for the whole circuit.
function makeTrackMesh() {
  const n = TRACK_SAMPLES;
  const positions = new Float32Array(n * 2 * 3);
  const uvs = new Float32Array(n * 2 * 2);
  const indices = [];
  for (let i = 0; i < n; i += 1) {
    const p = TRACK_POINTS[i];
    const bank = p.bank;
    // Plan left normal (-ty, tx) -> world (-ty, 0, -tx); bank rolls it up.
    const lx = -p.ty * Math.cos(bank);
    const lz = -p.tx * Math.cos(bank);
    const up = Math.sin(bank);
    const half = TRACK_HALF_WIDTH;
    const o = i * 6;
    // Banking raises the OUTER edge: for a left turn (bank > 0) the outer
    // edge is the right one, so the left vertex drops and the right rises.
    positions[o] = p.x + lx * half;
    positions[o + 1] = p.h - up * half;
    positions[o + 2] = -p.y + lz * half;
    positions[o + 3] = p.x - lx * half;
    positions[o + 4] = p.h + up * half;
    positions[o + 5] = -p.y - lz * half;
    const uo = i * 4;
    uvs[uo] = (i / n) * 120;
    uvs[uo + 1] = 0;
    uvs[uo + 2] = (i / n) * 120;
    uvs[uo + 3] = 1;
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // Winding (a, a+1, b): the front face points UP. The old order
    // (a, b, a+1) put the normal DOWN, so with FrontSide culling the
    // whole asphalt was invisible from the chase camera — the karts
    // looked like they were floating on the ground grid.
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // Brighter asphalt than the old near-black: the track must read as a
  // road, not a hole in the ground.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x35306b,
    roughness: 0.75,
    metalness: 0.15,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// A thin glowing ribbon along the track at a fixed lateral offset.
// latCenter 0 is the centreline; width is the ribbon's width in px.
function makeRibbon(latCenter, width, color, yOff) {
  const n = TRACK_SAMPLES;
  const positions = new Float32Array(n * 2 * 3);
  const indices = [];
  const half = width / 2;
  for (let i = 0; i < n; i += 1) {
    const p = TRACK_POINTS[i];
    const bank = p.bank;
    const lx = -p.ty * Math.cos(bank);
    const lz = -p.tx * Math.cos(bank);
    const up = Math.sin(bank);
    const o = i * 6;
    positions[o] = p.x + lx * (latCenter + half);
    positions[o + 1] = p.h - up * (latCenter + half) + yOff;
    positions[o + 2] = -p.y + lz * (latCenter + half);
    positions[o + 3] = p.x + lx * (latCenter - half);
    positions[o + 4] = p.h - up * (latCenter - half) + yOff;
    positions[o + 5] = -p.y + lz * (latCenter - half);
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    // Same up-facing winding as the track mesh (see above): the old
    // order culled both glow edges and the centre line from above.
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  return new THREE.Mesh(geo, mat);
}

// Shared kart geometries, built once.
const KART_GEO = {
  body: new THREE.BoxGeometry(30, 5, 18),
  nose: new THREE.BoxGeometry(12, 3.5, 12),
  cockpit: new THREE.BoxGeometry(12, 4.5, 10),
  spoiler: new THREE.BoxGeometry(2.5, 1, 21),
  spoilerPost: new THREE.BoxGeometry(1.5, 3, 1.5),
  wheel: new THREE.CylinderGeometry(4.6, 4.6, 3.2, 14),
  helmet: new THREE.SphereGeometry(3.6, 12, 10),
};
const KART_MAT_DARK = new THREE.MeshStandardMaterial({
  color: 0x0a0618,
  roughness: 0.4,
  metalness: 0.7,
});
const KART_MAT_TYRE = new THREE.MeshStandardMaterial({
  color: 0x111111,
  roughness: 0.95,
  metalness: 0.0,
});
const KART_MAT_HELMET = new THREE.MeshStandardMaterial({
  color: 0xf5f0ff,
  roughness: 0.25,
  metalness: 0.3,
});

function buildKartMesh(colorHex) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.32,
    metalness: 0.55,
    emissive: colorHex,
    emissiveIntensity: 0.22,
  });
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    group.add(m);
    return m;
  };
  add(KART_GEO.body, bodyMat, 0, 5, 0);
  add(KART_GEO.nose, bodyMat, 17, 4.2, 0);
  add(KART_GEO.cockpit, KART_MAT_DARK, -2, 8.6, 0);
  add(KART_GEO.helmet, KART_MAT_HELMET, -2, 10.5, 0);
  add(KART_GEO.spoiler, bodyMat, -15.5, 10.5, 0);
  add(KART_GEO.spoilerPost, KART_MAT_DARK, -15.5, 8.4, -6);
  add(KART_GEO.spoilerPost, KART_MAT_DARK, -15.5, 8.4, 6);
  // Wheels: cylinders rotated so their axis is across the kart (z).
  add(KART_GEO.wheel, KART_MAT_TYRE, 10, 4.6, -9.5, Math.PI / 2, 0);
  add(KART_GEO.wheel, KART_MAT_TYRE, 10, 4.6, 9.5, Math.PI / 2, 0);
  add(KART_GEO.wheel, KART_MAT_TYRE, -10, 4.6, -9.5, Math.PI / 2, 0);
  add(KART_GEO.wheel, KART_MAT_TYRE, -10, 4.6, 9.5, Math.PI / 2, 0);
  // Karts read bigger on screen (A3): scale the whole group 1.3x.
  group.scale.setScalar(1.3);
  return group;
}

// Build every track-dependent object for the CURRENT track tables.
// Returns { group, pads, padMat }: the group to add to the scene, the
// boost-pad meshes (repositioned when the pads shift each lap), and the
// pad material (pulsed every frame).
function buildTrackGroup() {
  const group = new THREE.Group();

  // Track + glow edges + centre line + dashes + start line + boost pads.
  group.add(makeTrackMesh());
  group.add(makeRibbon(TRACK_HALF_WIDTH - 2, 3.5, 0x22d3ee, 0.35));
  group.add(makeRibbon(-(TRACK_HALF_WIDTH - 2), 3.5, 0xff2e88, 0.35));
  group.add(makeRibbon(0, 2.5, 0x8b7cff, 0.3));

  const dashGeo = new THREE.BoxGeometry(12, 0.3, 3);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xf5f0ff });
  const dashCount = Math.floor(TRACK_SAMPLES / 4);
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashCount);
  for (let k = 0; k < dashCount; k += 1) {
    const i = k * 4;
    const p = TRACK_POINTS[i];
    _e1.set(0, p.angle, 0);
    _q1.setFromEuler(_e1);
    _v1.set(p.x, p.h + 0.25, -p.y);
    _m1.compose(_v1, _q1, _v2.set(1, 1, 1));
    dashes.setMatrixAt(k, _m1);
  }
  group.add(dashes);

  const startLineGeo = new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2, 14);
  startLineGeo.rotateX(-Math.PI / 2);
  const startLine = new THREE.Mesh(
    startLineGeo,
    new THREE.MeshBasicMaterial({ map: makeCheckerTexture() }),
  );
  {
    const p = TRACK_POINTS[0];
    startLine.position.set(p.x, p.h + 0.3, -p.y);
    // Width spans across the track: rotate so local +X is perpendicular
    // to the track direction.
    startLine.rotation.y = p.angle + Math.PI / 2;
  }
  group.add(startLine);

  const padMat = new THREE.MeshStandardMaterial({
    color: 0xffb020,
    emissive: 0xffb020,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  // Wider, deeper pads: full track width, so they read from the chase cam.
  const padGeo = new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2, 2, 30);
  const pads = [];
  for (const pad of BOOST_PADS) {
    const mesh = new THREE.Mesh(padGeo, padMat);
    mesh.position.set(pad.x, TRACK_POINTS[pad.sample].h + 0.4, -pad.y);
    mesh.rotation.y = pad.angle;
    group.add(mesh);
    pads.push(mesh);
  }

  // Arches over the track: posts + beam + neon strip, every ~60 samples.
  const archPostGeo = new THREE.CylinderGeometry(3, 3.5, 46, 10);
  const archBeamGeo = new THREE.BoxGeometry(150, 5, 6);
  const archStripGeo = new THREE.BoxGeometry(150, 1.2, 1.2);
  const archPostMat = new THREE.MeshStandardMaterial({
    color: 0x241a3d,
    roughness: 0.6,
    metalness: 0.5,
  });
  const archStripMat = new THREE.MeshBasicMaterial({ color: 0xff2e88, toneMapped: false });
  const archSamples = [40, 100, 160, 220, 280, 340, 400, 460];
  archSamples.forEach((sample, ai) => {
    const p = TRACK_POINTS[sample];
    const g = new THREE.Group();
    const left = new THREE.Mesh(archPostGeo, archPostMat);
    left.position.set(0, 23, -TRACK_HALF_WIDTH - 8);
    const right = new THREE.Mesh(archPostGeo, archPostMat);
    right.position.set(0, 23, TRACK_HALF_WIDTH + 8);
    const beam = new THREE.Mesh(archBeamGeo, archPostMat);
    beam.position.set(0, 46, 0);
    beam.rotation.y = Math.PI / 2;
    const strip = new THREE.Mesh(archStripGeo, ai % 2 === 0 ? archStripMat : new THREE.MeshBasicMaterial({ color: 0x22d3ee, toneMapped: false }));
    strip.position.set(0, 49, 0);
    strip.rotation.y = Math.PI / 2;
    g.add(left, right, beam, strip);
    g.position.set(p.x, p.h, -p.y);
    g.rotation.y = p.angle;
    group.add(g);
  });

  // Pylons: instanced posts with glowing tips ringing the outside edge.
  const pylonCount = 48;
  const pylonGeo = new THREE.BoxGeometry(4, 26, 4);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x1c1440,
    roughness: 0.6,
    metalness: 0.4,
  });
  const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, pylonCount);
  const tipGeo = new THREE.BoxGeometry(5, 2.5, 5);
  const tipMat = new THREE.MeshBasicMaterial({ color: 0xff2e88, toneMapped: false });
  const tips = new THREE.InstancedMesh(tipGeo, tipMat, pylonCount);
  for (let k = 0; k < pylonCount; k += 1) {
    const sample = Math.floor((k * TRACK_SAMPLES) / pylonCount);
    const p = TRACK_POINTS[sample];
    const lat = TRACK_HALF_WIDTH + 34;
    const x = p.x - p.ty * lat;
    const z = -(p.y + p.tx * lat);
    _e1.set(0, 0, 0);
    _q1.setFromEuler(_e1);
    _v1.set(x, p.h + 13, z);
    _m1.compose(_v1, _q1, _v2.set(1, 1, 1));
    pylons.setMatrixAt(k, _m1);
    _v1.set(x, p.h + 27, z);
    _m1.compose(_v1, _q1, _v2.set(1, 1, 1));
    tips.setMatrixAt(k, _m1);
  }
  group.add(pylons);
  group.add(tips);

  // Billboards: glowing word panels just outside the track, facing it.
  // Fixed words + fixed samples — no randomness, same every run.
  const words = ['NEON', 'RUSH', 'TURBO', 'DRIFT', 'BOOST', 'NEON', 'RUSH', 'TURBO', 'DRIFT', 'BOOST'];
  const boardGeo = new THREE.PlaneGeometry(70, 26);
  for (let k = 0; k < words.length; k += 1) {
    const sample = Math.floor(((k + 0.5) * TRACK_SAMPLES) / words.length);
    const p = TRACK_POINTS[sample];
    const lat = TRACK_HALF_WIDTH + 62;
    const x = p.x - p.ty * lat;
    const z = -(p.y + p.tx * lat);
    const tex = makeBillboardTexture(words[k]);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    const board = new THREE.Mesh(boardGeo, mat);
    board.position.set(x, p.h + 18, z);
    // Face ONCOMING karts (normal = -tangent): the chase camera looks
    // forward from behind the kart, so a board facing down-track shows
    // its mirrored back. p.angle - PI/2 turns the front toward the
    // approaching field, and the text reads correctly.
    board.rotation.y = p.angle - Math.PI / 2;
    group.add(board);
  }

  return { group, pads, padMat };
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a0b2e, 600, 5200);
  scene.add(makeSky());

  // Lights: warm low sun + cool hemisphere fill.
  const hemi = new THREE.HemisphereLight(0x8a7cff, 0x1a0b2e, 1.05);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.7);
  sun.castShadow = true;
  sun.position.set(1390, 320, -670);
  sun.target.position.set(1170, 0, -850);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 1600;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // Ground: dark grid plane far below the track's lowest point.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3200, 48),
    new THREE.MeshStandardMaterial({
      map: makeGridTexture(),
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(1170, -14, -850);
  ground.receiveShadow = true;
  scene.add(ground);

  // Track-dependent objects, rebuilt on track switches.
  let trackGroup = null;
  let padMeshes = [];
  let padMat = null;
  let lastPadVersion = -1;
  function installTrackGroup() {
    if (trackGroup) {
      scene.remove(trackGroup);
      trackGroup.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
          if (obj.material.map) obj.material.map.dispose();
        }
      });
    }
    const built = buildTrackGroup();
    trackGroup = built.group;
    padMeshes = built.pads;
    padMat = built.padMat;
    lastPadVersion = -1;
    scene.add(trackGroup);
  }
  installTrackGroup();

  // City skyline: deterministic ring of towers outside the circuit.
  // Radius clears the largest track (Sunset Bay, ~2,230 px from centre).
  const windowTex = makeWindowTexture();
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveMap: windowTex,
    emissiveIntensity: 0.7,
    map: windowTex,
    roughness: 0.8,
    metalness: 0.2,
  });
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  const centerX = 1170;
  const centerZ = -850;
  for (let k = 0; k < 24; k += 1) {
    const angle = (k / 24) * Math.PI * 2 + (k % 3) * 0.11;
    const radius = 2500 + ((k * 137) % 420);
    const w = 90 + ((k * 53) % 90);
    const hgt = 90 + ((k * 97) % 220);
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.scale.set(w, hgt, w);
    tower.position.set(
      centerX + Math.cos(angle) * radius,
      -14 + hgt / 2,
      centerZ + Math.sin(angle) * radius,
    );
    tower.rotation.y = angle;
    scene.add(tower);
  }

  // Karts, one group each, built once and re-posed every frame.
  const kartGroups = new Map();

  // Player marker: a floating chevron above the player's kart.
  const marker = new THREE.Mesh(
    new THREE.ConeGeometry(5, 10, 4),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  );
  marker.rotation.x = Math.PI;
  scene.add(marker);

  // Particles: one Points cloud for smoke/flames/sparks/confetti, plus a
  // LineSegments pool for speed lines. Buffers are preallocated at the cap.
  const MAX_PARTICLES = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({
    size: 7,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  scene.add(points);

  const MAX_LINES = 60;
  const lGeo = new THREE.BufferGeometry();
  const lPos = new Float32Array(MAX_LINES * 2 * 3);
  lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
  const lines = new THREE.LineSegments(
    lGeo,
    new THREE.LineBasicMaterial({ color: 0xaefcff, transparent: true, opacity: 0.7 }),
  );
  lines.frustumCulled = false;
  scene.add(lines);

  const camera = new THREE.PerspectiveCamera(62, 1, 1, 8000);
  camera.position.set(420, 200, -300);

  // Camera smoothing state. In shot mode the camera snaps (deterministic);
  // in live play it eases toward the chase target.
  const camState = { pos: new THREE.Vector3(420, 200, -300), look: new THREE.Vector3(420, 0, -300) };
  let shotMode = false;

  function updateCamera(race, time) {
    const player = race.player;
    const elev = elevationAt(player.sample);
    if (race.state === 'menu') {
      if (shotMode) {
        // Fixed view down the starting grid: all eight karts, the start
        // straight, the arches, and the skyline behind them.
        const fx = Math.cos(player.angle);
        const fz = -Math.sin(player.angle);
        _v1.set(player.x - fx * 110, elev + 48, -player.y - fz * 110);
        _v2.set(player.x + fx * 110, elev + 4, -player.y + fz * 110);
        camState.pos.copy(_v1);
        camState.look.copy(_v2);
      } else {
        // Slow orbit around the circuit centre, driven by the fixed clock.
        // Radius clears the largest track, so the orbit never dives
        // through the ribbon.
        const t = race.frame * STEP;
        const cx = 1170;
        const cz = -850;
        const orbit = 0.12 * t;
        _v1.set(cx + Math.cos(orbit) * 1500, 450, cz + Math.sin(orbit) * 1500);
        _v2.set(cx, 0, cz);
        camState.pos.lerp(_v1, 0.04);
        camState.look.lerp(_v2, 0.06);
      }
      camera.position.copy(camState.pos);
      camera.lookAt(camState.look);
      camera.fov = 58;
      camera.updateProjectionMatrix();
      return;
    }
    if (race.state === 'results' || race.state === 'season' || race.state === 'champion') {
      // Gentle orbit around the player's kart.
      const t = race.frame * STEP;
      const px = player.x;
      const pz = -player.y;
      _v1.set(px + Math.cos(t * 0.25) * 120, elev + 55, pz + Math.sin(t * 0.25) * 120);
      _v2.set(px, elev + 4, pz);
      if (shotMode) {
        camState.pos.copy(_v1);
        camState.look.copy(_v2);
      } else {
        camState.pos.lerp(_v1, 0.05);
        camState.look.lerp(_v2, 0.06);
      }
      camera.position.copy(camState.pos);
      camera.lookAt(camState.look);
      camera.fov = 55;
      camera.updateProjectionMatrix();
      return;
    }
    // Chase cam: behind and above the player kart, looking ahead.
    // Closer and lower than before (A3) so the kart always reads.
    const fx = Math.cos(player.angle);
    const fz = -Math.sin(player.angle);
    const dist = 76;
    const height = 32;
    _v1.set(player.x - fx * dist, elev + height, -player.y - fz * dist);
    _v2.set(player.x + fx * 70, elev + 5, -player.y + fz * 70);
    // Screen shake: deterministic wobble from the fixed frame counter.
    if (race.shake > 0) {
      _v1.x += Math.sin(race.frame * 1.7) * race.shake * 0.5;
      _v1.y += Math.cos(race.frame * 2.3) * race.shake * 0.4;
    }
    if (shotMode) {
      camState.pos.copy(_v1);
      camState.look.copy(_v2);
    } else {
      camState.pos.lerp(_v1, 0.16);
      camState.look.lerp(_v2, 0.22);
    }
    camera.position.copy(camState.pos);
    camera.lookAt(camState.look);
    const speedNorm = Math.abs(player.speed) / 720;
    const targetFov = 64 + speedNorm * 8 + (player.boosting ? 9 : 0);
    camera.fov += (targetFov - camera.fov) * (shotMode ? 1 : 0.12);
    camera.updateProjectionMatrix();
    // The sun's shadow camera follows the player so shadows stay crisp.
    sun.position.set(player.x + 220, elev + 320, -player.y + 180);
    sun.target.position.set(player.x, elev, -player.y);
  }

  function updateKarts(race) {
    for (const kart of race.karts) {
      let group = kartGroups.get(kart.id);
      if (!group) {
        group = buildKartMesh(kart.color);
        kartGroups.set(kart.id, group);
        scene.add(group);
      }
      const elev = elevationAt(kart.sample);
      group.position.set(kart.x, elev + 0.4, -kart.y);
      // YXZ: yaw = plan angle, roll leans INTO the bank (local +Z is the
      // kart's right, so a left turn needs a negative roll), pitch follows
      // the elevation slope.
      const slope = Math.atan2(
        elevationAt(kart.sample + 2) - elevationAt(kart.sample - 2 + TRACK_SAMPLES),
        42,
      );
      _e1.set(-bankAt(kart.sample) * 0.6, kart.angle, slope);
      group.rotation.copy(_e1);
    }
    // Marker bobs above the player kart, driven by the fixed clock.
    const player = race.player;
    marker.position.set(
      player.x,
      elevationAt(player.sample) + 26 + Math.sin(race.frame * STEP * 3) * 2,
      -player.y,
    );
    marker.visible = race.state !== 'menu';
  }

  function updateParticles(race) {
    let pi = 0;
    let li = 0;
    for (const p of race.particles.list) {
      if (p.kind === 'line') {
        if (li >= MAX_LINES) continue;
        const o = li * 6;
        lPos[o] = p.x;
        lPos[o + 1] = p.y;
        lPos[o + 2] = p.z;
        lPos[o + 3] = p.x - p.vx * 0.05;
        lPos[o + 4] = p.y - p.vy * 0.05;
        lPos[o + 5] = p.z - p.vz * 0.05;
        li += 1;
        continue;
      }
      if (pi >= MAX_PARTICLES) continue;
      const o = pi * 3;
      pPos[o] = p.x;
      pPos[o + 1] = p.y;
      pPos[o + 2] = p.z;
      const col = new THREE.Color(p.color);
      const fade = 0.35 + 0.65 * (p.life / p.maxLife);
      pCol[o] = col.r * fade;
      pCol[o + 1] = col.g * fade;
      pCol[o + 2] = col.b * fade;
      pi += 1;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    pGeo.setDrawRange(0, pi);
    lGeo.attributes.position.needsUpdate = true;
    lGeo.setDrawRange(0, li * 2);
  }

  return {
    setShotMode(value) {
      shotMode = value;
    },
    rebuildTrack() {
      installTrackGroup();
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    render(race) {
      // Boost pads shifted this lap: move the pad meshes to the new spots.
      if (race.padVersion !== lastPadVersion) {
        for (let i = 0; i < padMeshes.length && i < BOOST_PADS.length; i += 1) {
          const pad = BOOST_PADS[i];
          padMeshes[i].position.set(pad.x, TRACK_POINTS[pad.sample].h + 0.4, -pad.y);
          padMeshes[i].rotation.y = pad.angle;
        }
        lastPadVersion = race.padVersion;
      }
      updateCamera(race);
      updateKarts(race);
      updateParticles(race);
      // Boost pads pulse with the fixed race clock.
      if (padMat) padMat.emissiveIntensity = 1.15 + 0.45 * Math.sin(race.raceTime * 5);
      renderer.render(scene, camera);
    },
  };
}
