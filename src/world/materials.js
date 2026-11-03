import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Palette                                                            */
/* ------------------------------------------------------------------ */
export const PALETTE = {
  grass: 0x5f8442,
  grassDark: 0x35522d,
  grassLight: 0x7ba151,
  dirt: 0x967a53,
  dirtDark: 0x634f37,
  wood: 0x4a3728,
  woodLight: 0x6a5038,
  plaster: 0x9c8a70,
  plasterDark: 0x776a57,
  stone: 0x878577,
  stoneDark: 0x55544a,
  iron: 0x202521,
  roof: 0x6d5866,
  roofLight: 0x8a7284,
  leafA: 0x5a8639,
  leafB: 0x3e682f,
  leafC: 0x79a14a,
  leafAutumn: 0xa8642e,
  deadbark: 0x3d352b,
  water: 0x2c6667,
  waterLight: 0x4d8f88,
  window: 0xffb559,
  windowCore: 0xffe0a3,
  skin: 0xd4a97e,
  skinZombie: 0x869a6e,
  coat: 0x7a3c31,
  coatDark: 0x552a23,
  pants: 0x2f3634,
  leather: 0x35281e,
  bone: 0xd8cfb9,
  blood: 0x8d2f2a,
};

/* ------------------------------------------------------------------ */
/*  Toon gradient + materials                                          */
/* ------------------------------------------------------------------ */
let gradientMap = null;

export function getGradientMap() {
  if (!gradientMap) {
    const data = new Uint8Array([82, 150, 205, 240, 255]);
    gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.needsUpdate = true;
  }
  return gradientMap;
}

const matCache = new Map();

export function toon(color, opts = {}) {
  // Textures are not serialisable into a cache key — skip caching for mapped mats.
  const cacheable = !opts.map;
  const key = cacheable ? `t${color}-${JSON.stringify(opts)}` : null;
  if (key && matCache.has(key)) return matCache.get(key);
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
    ...opts,
  });
  if (key) matCache.set(key, mat);
  return mat;
}

export function basic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}

/* ------------------------------------------------------------------ */
/*  Canvas textures                                                    */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(size, draw, { repeat = 1, srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function grassTexture() {
  return canvasTexture(1024, (c, s) => {
    const rnd = mulberry32(77123);
    c.fillStyle = '#587b3c';
    c.fillRect(0, 0, s, s);

    for (let i = 0; i < 4200; i++) {
      const x = rnd() * s, y = rnd() * s, r = 6 + rnd() * 46;
      const g = 58 + rnd() * 62, r2 = 38 + rnd() * 44, b = 24 + rnd() * 30;
      c.fillStyle = `rgba(${r2 | 0},${g | 0},${b | 0},${0.035 + rnd() * 0.09})`;
      c.beginPath();
      c.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * 6.28, 0, 6.28);
      c.fill();
    }

    // painterly blades
    for (let i = 0; i < 7000; i++) {
      const x = rnd() * s, y = rnd() * s;
      const len = 3 + rnd() * 10;
      const g = 90 + rnd() * 70;
      c.strokeStyle = `rgba(${30 + rnd() * 40 | 0},${g | 0},${28 + rnd() * 25 | 0},${0.18 + rnd() * 0.35})`;
      c.lineWidth = 0.7 + rnd() * 1.1;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (rnd() - 0.5) * 4, y - len);
      c.stroke();
    }

    // dark soil holes
    for (let i = 0; i < 45; i++) {
      const x = rnd() * s, y = rnd() * s, r = 10 + rnd() * 40;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(32,45,22,.18)');
      g.addColorStop(1, 'rgba(32,45,22,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill();
    }

    // tiny wildflowers
    for (let i = 0; i < 120; i++) {
      const x = rnd() * s, y = rnd() * s;
      c.fillStyle = rnd() > 0.35 ? 'rgba(238,234,208,.7)' : 'rgba(230,204,120,.75)';
      c.beginPath(); c.arc(x, y, 1.1 + rnd() * 1.3, 0, 6.28); c.fill();
    }
  }, { repeat: 9 });
}

export function dirtTexture() {
  return canvasTexture(512, (c, s) => {
    const rnd = mulberry32(9241);
    c.fillStyle = '#977c56';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s, y = rnd() * s, r = 2 + rnd() * 20;
      c.fillStyle = `rgba(${60 + rnd() * 50 | 0},${48 + rnd() * 36 | 0},${30 + rnd() * 26 | 0},${0.05 + rnd() * 0.13})`;
      c.beginPath(); c.ellipse(x, y, r, r * 0.6, rnd() * 6.28, 0, 6.28); c.fill();
    }
    for (let i = 0; i < 900; i++) {
      const x = rnd() * s, y = rnd() * s;
      c.fillStyle = `rgba(${110 + rnd() * 60 | 0},${100 + rnd() * 50 | 0},${80 + rnd() * 40 | 0},${0.2 + rnd() * 0.35})`;
      c.beginPath(); c.ellipse(x, y, 1 + rnd() * 3.5, 1 + rnd() * 2.5, rnd() * 3, 0, 6.28); c.fill();
    }
    for (let i = 0; i < 120; i++) {
      const x = rnd() * s, y = rnd() * s;
      c.strokeStyle = `rgba(60,48,32,${0.12 + rnd() * 0.18})`;
      c.lineWidth = 0.8;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 22, y + (rnd() - 0.5) * 10); c.stroke();
    }
  }, { repeat: 3 });
}

export function stoneTexture() {
  return canvasTexture(512, (c, s) => {
    const rnd = mulberry32(3312);
    c.fillStyle = '#6c6b5d';
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 1600; i++) {
      const x = rnd() * s, y = rnd() * s, r = 2 + rnd() * 26;
      const v = 62 + rnd() * 50;
      c.fillStyle = `rgba(${v | 0},${v - 3 | 0},${v - 12 | 0},${0.04 + rnd() * 0.12})`;
      c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill();
    }
    // block joints
    c.strokeStyle = 'rgba(38,38,32,.35)';
    for (let y = 0; y < s; y += 64) {
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, y); c.lineTo(s, y); c.stroke();
      const off = (y / 64) % 2 ? 0 : 64;
      for (let x = off; x < s; x += 128) {
        c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 64); c.stroke();
      }
    }
    // moss
    for (let i = 0; i < 130; i++) {
      const x = rnd() * s, y = rnd() * s, r = 5 + rnd() * 22;
      c.fillStyle = `rgba(62,84,44,${0.03 + rnd() * 0.09})`;
      c.beginPath(); c.arc(x, y, r, 0, 6.28); c.fill();
    }
  }, { repeat: 3 });
}

export function roofTexture() {
  return canvasTexture(512, (c, s) => {
    const rnd = mulberry32(8145);
    c.fillStyle = '#6a5362';
    c.fillRect(0, 0, s, s);
    const rowH = 34;
    for (let row = 0; row * rowH < s; row++) {
      const y = row * rowH;
      const off = row % 2 ? 26 : 0;
      c.fillStyle = row % 2 ? 'rgba(255,255,255,.022)' : 'rgba(0,0,0,.06)';
      c.fillRect(0, y, s, rowH);
      for (let x = -off; x < s; x += 52) {
        c.strokeStyle = 'rgba(12,9,13,.55)';
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + rowH); c.stroke();
        c.strokeStyle = 'rgba(120,104,122,.16)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(x + 2, y + 1); c.lineTo(x + 2, y + rowH * 0.55); c.stroke();
        // damaged shingles
        if (rnd() > 0.965) {
          c.fillStyle = 'rgba(20,16,20,.6)';
          c.fillRect(x + 5, y + 5, 26, rowH - 8);
        }
      }
      c.strokeStyle = 'rgba(9,7,10,.7)';
      c.lineWidth = 2.4;
      c.beginPath(); c.moveTo(0, y + rowH); c.lineTo(s, y + rowH); c.stroke();
    }
    for (let i = 0; i < 300; i++) {
      c.fillStyle = `rgba(110,100,80,${0.015 + rnd() * 0.05})`;
      c.beginPath(); c.arc(rnd() * s, rnd() * s, 1 + rnd() * 8, 0, 6.28); c.fill();
    }
  }, { repeat: 2 });
}

export function woodTexture() {
  return canvasTexture(512, (c, s) => {
    const rnd = mulberry32(4471);
    c.fillStyle = '#5f4a34';
    c.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 64) {
      c.fillStyle = `rgba(35,26,18,${0.1 + rnd() * 0.2})`;
      c.fillRect(x, 0, 2, s);
      c.fillStyle = `rgba(150,120,84,${0.03 + rnd() * 0.06})`;
      c.fillRect(x + 2, 0, 8, s);
      for (let i = 0; i < 32; i++) {
        const y = rnd() * s;
        c.strokeStyle = `rgba(45,33,23,${0.08 + rnd() * 0.12})`;
        c.lineWidth = 0.7 + rnd();
        c.beginPath();
        c.moveTo(x + 4, y);
        c.bezierCurveTo(x + 20, y + 4, x + 38, y - 5, x + 62, y + 2);
        c.stroke();
      }
    }
  }, { repeat: 2 });
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  glowTex = canvasTexture(256, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,238,196,.9)');
    g.addColorStop(0.45, 'rgba(255,190,110,.35)');
    g.addColorStop(1, 'rgba(255,160,60,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }, { srgb: true });
  return glowTex;
}

export function smokeTexture() {
  return canvasTexture(256, (c, s) => {
    const rnd = mulberry32(992);
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(210,214,200,.55)');
    g.addColorStop(0.5, 'rgba(180,186,174,.2)');
    g.addColorStop(1, 'rgba(170,176,166,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      const a = rnd() * 6.28, r = rnd() * s * 0.32;
      c.fillStyle = `rgba(200,204,190,${0.03 + rnd() * 0.05})`;
      c.beginPath();
      c.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, 10 + rnd() * 35, 0, 6.28);
      c.fill();
    }
  }, { srgb: true });
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                   */
/* ------------------------------------------------------------------ */
export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function gableGeometry(width, height, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.lineTo(-width / 2, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

export function addOutline(group, thickness = 1.045) {
  const meshes = [];
  group.traverse((o) => {
    if (o.isMesh && !o.userData.noOutline) meshes.push(o);
  });
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x0a0d0a,
    side: THREE.BackSide,
  });
  for (const m of meshes) {
    const o = new THREE.Mesh(m.geometry, outlineMat);
    o.userData.noOutline = true;
    o.position.copy(m.position);
    o.quaternion.copy(m.quaternion);
    o.scale.copy(m.scale).multiplyScalar(thickness);
    o.renderOrder = -1;
    m.add(o);
    // child outline inherits m's own transform; offset local scale is applied relative
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(thickness, thickness, thickness);
  }
  return group;
}

export function addGlowSprite(parent, color = 0xffc06a, scale = 3, position = [0, 0, 0], opacity = 0.8) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale, 1);
  s.position.set(...position);
  parent.add(s);
  return s;
}

export function seededShuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/*  Static batching                                                   */
/* ------------------------------------------------------------------ */
/*
 * Bakes every non-animated mesh under `root` into one mesh per material.
 * Transforms are applied into the geometry, so the merged meshes are added
 * to `parent` (the root's parent) with identity transforms. Meshes tagged
 * `userData.noMerge` (and any instanced meshes) stay where they are.
 */
export function mergeStatic(root, parent = root.parent) {
  if (!parent) return [];
  root.updateMatrixWorld(true);

  const buckets = new Map();
  const excluded = (o) => {
    let p = o;
    while (p && p !== root) {
      if (p.userData && p.userData.noMerge) return true;
      p = p.parent;
    }
    return false;
  };

  const found = [];
  root.traverse((o) => {
    if (o.isMesh && !o.isInstancedMesh && o.visible) found.push(o);
  });

  for (const m of found) {
    if (excluded(m)) continue;
    const mat = m.material;
    let b = buckets.get(mat.uuid);
    if (!b) {
      b = { material: mat, pos: [], nor: [], uv: [], cast: false, receive: false };
      buckets.set(mat.uuid, b);
    }
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const u = g.getAttribute('uv');
    if (!p) continue;
    for (let i = 0; i < p.count * 3; i++) b.pos.push(p.array[i]);
    if (n) for (let i = 0; i < p.count * 3; i++) b.nor.push(n.array[i]);
    else for (let i = 0; i < p.count * 3; i++) b.nor.push(0, 1, 0);
    if (u) for (let i = 0; i < u.count * 2; i++) b.uv.push(u.array[i]);
    else for (let i = 0; i < p.count * 2; i++) b.uv.push(0, 0);
    b.cast = b.cast || m.castShadow;
    b.receive = b.receive || m.receiveShadow;
    m.removeFromParent();
    g.dispose();
  }

  const merged = [];
  for (const b of buckets.values()) {
    if (!b.pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.userData.merged = true;
    parent.add(mesh);
    merged.push(mesh);
  }
  return merged;
}

export { mulberry32 };
