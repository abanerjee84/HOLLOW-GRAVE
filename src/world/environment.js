import * as THREE from 'three';
import {
  PALETTE, toon, basic, box, gableGeometry, addGlowSprite, mergeStatic,
  grassTexture, dirtTexture, stoneTexture, roofTexture, woodTexture,
  smokeTexture, mulberry32,
} from './materials.js';

export const WORLD = {
  half: 33,
  houseZ: -21,
  gateZ: -11,
  spawnPoints: [
    new THREE.Vector3(0, 0, 32),
    new THREE.Vector3(28, 0, 24),
    new THREE.Vector3(-28, 0, 22),
    new THREE.Vector3(30, 0, -4),
    new THREE.Vector3(-30, 0, -8),
  ],
};

/* ------------------------------------------------------------------ */
/*  Small geometry helpers                                             */
/* ------------------------------------------------------------------ */
function ribbonGeometry(points, widths, segments = 80) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z))
  );
  const pos = [];
  const uv = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up).normalize();
    const widthT = t * (widths.length - 1);
    const wi = Math.floor(widthT);
    const w = THREE.MathUtils.lerp(widths[wi], widths[Math.min(wi + 1, widths.length - 1)], widthT - wi);
    const half = w * 0.5;
    pos.push(p.x - side.x * half, 0, p.z - side.z * half);
    pos.push(p.x + side.x * half, 0, p.z + side.z * half);
    uv.push(0, t * 8, 1, t * 8);
    if (i < segments) {
      const a = i * 2;
      // wind counter-clockwise seen from above so the ribbon faces the camera
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, curve };
}

function distanceToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (!l2) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/* ------------------------------------------------------------------ */
/*  Water                                                             */
/* ------------------------------------------------------------------ */
function createWater(points, widths, scene) {
  const { geo } = ribbonGeometry(points, widths, 90);
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: false,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(uv.x * 6.28 + uv.y * 5.0) * 0.025;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv;
        float w = sin(p.y * 7.0 + uTime * 0.55 + sin(p.x * 6.0)) * 0.5
                + sin(p.y * 14.0 - uTime * 0.34 + p.x * 9.0) * 0.28
                + sin(p.y * 31.0 + uTime * 0.7 + p.x * 20.0) * 0.12;
        float b1 = smoothstep(-0.30, -0.08, w);
        float b2 = smoothstep(0.16, 0.38, w);
        float b3 = smoothstep(0.56, 0.74, w);
        vec3 deep  = vec3(0.006, 0.034, 0.040);
        vec3 mid   = vec3(0.018, 0.092, 0.094);
        vec3 light = vec3(0.052, 0.196, 0.178);
        vec3 hi    = vec3(0.155, 0.340, 0.285);
        vec3 col = mix(deep, mid, b1);
        col = mix(col, light, b2 * 0.72);
        col = mix(col, hi, b3 * 0.5);
        float edge = smoothstep(0.0, 0.11, min(p.x, 1.0 - p.x));
        col = mix(vec3(0.030, 0.038, 0.020), col, edge * 0.92);
        // scattered glints
        float glint = step(0.988, fract(sin(dot(floor(p * vec2(90.0, 260.0)), vec2(12.9898,78.233))) * 43758.5453));
        float twinkle = 0.45 + 0.55 * sin(uTime * 2.0 + p.y * 40.0);
        col += glint * twinkle * vec3(0.30, 0.36, 0.25);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  mat.toneMapped = true;
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'water';
  mesh.position.y = 0.075;
  mesh.receiveShadow = false;
  scene.add(mesh);
  return { mesh, uniforms };
}

/* ------------------------------------------------------------------ */
/*  Paths                                                             */
/* ------------------------------------------------------------------ */
function createPaths(scene) {
  const group = new THREE.Group();
  const dirt = dirtTexture();
  dirt.repeat.set(1, 1);
  const mat = new THREE.MeshToonMaterial({
    map: dirt, color: 0xe9dcc2, side: THREE.DoubleSide,
    gradientMap: toon(0xffffff).gradientMap,
  });
  const main = [[0, -11.4], [-0.4, -7], [-1.8, 1], [1.2, 11], [0.2, 20], [-2.5, 31], [-3.5, 37]];
  const w = [4.0, 3.4, 3.1, 3.0, 3.2, 3.3, 3.5];
  const { geo } = ribbonGeometry(main, w, 100);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'mainPath';
  mesh.position.y = 0.025;
  mesh.receiveShadow = true;
  group.add(mesh);

  const branch = [[0.8, 10], [6, 8.5], [13, 6.2], [19, 3.4], [24, -2], [26, -8]];
  const bw = [2.0, 2.0, 1.9, 1.8, 1.7, 1.5];
  const bg = ribbonGeometry(branch, bw, 60);
  const bm = new THREE.Mesh(bg.geo, mat);
  bm.position.y = 0.024;
  bm.receiveShadow = true;
  group.add(bm);

  const trail = [[-9, -11], [-14, -9.5], [-18, -7.5], [-20.5, -5]];
  const tg = ribbonGeometry(trail, [1.5, 1.4, 1.3, 1.2], 30);
  const tm = new THREE.Mesh(tg.geo, mat);
  tm.position.y = 0.024;
  group.add(tm);

  scene.add(group);
  mergeStatic(group);
  return main;
}

/* ------------------------------------------------------------------ */
/*  Bridge                                                            */
/* ------------------------------------------------------------------ */
function createBridge(scene) {
  const g = new THREE.Group();
  const wood = toon(PALETTE.wood, { map: woodTexture() });
  const dark = toon(PALETTE.woodLight);
  const length = 10;
  const width = 3.6;
  const plankN = 20;
  for (let i = 0; i < plankN; i++) {
    const t = i / (plankN - 1);
    const x = (t - 0.5) * length;
    const y = 0.65 + Math.sin(t * Math.PI) * 1.0;
    const p = box(length / plankN - 0.035, 0.14, width + Math.sin(i * 1.7) * 0.12, wood, x, y, 0);
    p.rotation.z = Math.cos(t * Math.PI) * 0.14;
    g.add(p);
  }
  // rails
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const x = (t - 0.5) * (length - 0.6);
      const y = 0.65 + Math.sin(t * Math.PI) * 1.0;
      const post = box(0.16, 1.25, 0.16, dark, x, y + 0.6, side * (width / 2 - 0.1));
      g.add(post);
    }
    for (let seg = 0; seg < 4; seg++) {
      const t0 = seg / 4, t1 = (seg + 1) / 4;
      const x0 = (t0 - 0.5) * (length - 0.6), x1 = (t1 - 0.5) * (length - 0.6);
      const y0 = 1.25 + Math.sin(t0 * Math.PI) * 1.0;
      const y1 = 1.25 + Math.sin(t1 * Math.PI) * 1.0;
      const b = box(Math.hypot(x1 - x0, y1 - y0), 0.1, 0.12, dark, (x0 + x1) / 2, (y0 + y1) / 2, side * (width / 2 - 0.1));
      b.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      g.add(b);
    }
  }
  // support legs
  for (const x of [-3.6, 0, 3.6]) {
    for (const z of [-1.35, 1.35]) {
      const post = box(0.22, 2.0, 0.22, dark, x, 0.0, z);
      g.add(post);
    }
  }
  g.position.set(-23.5, 0, 6.5);
  scene.add(g);
  mergeStatic(g);
  return g;
}

/* ------------------------------------------------------------------ */
/*  Gothic house                                                      */
/* ------------------------------------------------------------------ */
function addWindow(parent, opts) {
  const {
    x, y, z, ry = 0, w = 1.1, h = 1.5, glow = 0.95, attic = false,
  } = opts;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;

  const frameMat = toon(PALETTE.wood);
  const frame = box(w + 0.28, h + 0.28, 0.14, frameMat, 0, 0, 0);
  g.add(frame);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    basic(glow > 0.7 ? PALETTE.window : 0x8a5a2e)
  );
  glass.position.z = 0.085;
  g.add(glass);

  const glowMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.72, h * 0.72),
    basic(PALETTE.windowCore)
  );
  glowMesh.position.z = 0.095;
  glowMesh.material.opacity = 0.8;
  glowMesh.material.transparent = true;
  glowMesh.scale.setScalar(glow);
  g.add(glowMesh);

  const barMat = toon(0x1a1713);
  g.add(box(0.07, h, 0.05, barMat, 0, 0, 0.11));
  g.add(box(w, 0.07, 0.05, barMat, 0, h * 0.15, 0.11));
  g.add(box(0.055, h, 0.04, barMat, -w * 0.28, 0, 0.12));
  g.add(box(0.055, h, 0.04, barMat, w * 0.28, 0, 0.12));

  if (attic) {
    const arch = new THREE.Mesh(
      new THREE.CircleGeometry(w * 0.55, 10, 0, Math.PI),
      basic(PALETTE.window)
    );
    arch.position.set(0, h / 2, 0.085);
    g.add(arch);
  }

  const sill = box(w + 0.55, 0.13, 0.35, toon(PALETTE.stoneDark), 0, -h / 2 - 0.2, 0.08);
  g.add(sill);
  parent.add(g);
  return g;
}

function createHouse(scene) {
  const group = new THREE.Group();
  group.position.set(0, 0, WORLD.houseZ);

  const plaster = toon(PALETTE.plaster);
  const plasterDark = toon(PALETTE.plasterDark);
  const timber = toon(PALETTE.wood);
  const stone = toon(PALETTE.stone, { map: stoneTexture() });
  const stoneDark = toon(PALETTE.stoneDark);
  const roofMat = toon(0x9d8b93, { map: roofTexture() });
  const iron = toon(PALETTE.iron);

  /* foundation */
  const base = box(13.8, 1.8, 9.8, stone, 0, 0.9, 0);
  group.add(base);
  group.add(box(14.3, 0.35, 10.3, stoneDark, 0, 1.78, 0));

  /* ground floor */
  const ground = box(13, 5.2, 9, plaster, 0, 4.4, 0);
  group.add(ground);
  /* upper floor, slightly overhanging */
  const upper = box(13.4, 3.8, 9.4, plasterDark, 0, 8.9, 0);
  group.add(upper);
  group.add(box(14.0, 0.4, 10.0, timber, 0, 7.0, 0));
  group.add(box(13.8, 0.3, 9.8, timber, 0, 10.85, 0));

  /* roof */
  const roof = new THREE.Mesh(gableGeometry(15, 6.0, 11.4), roofMat);
  roof.position.set(0, 10.8, 0);
  roof.castShadow = true;
  roof.receiveShadow = true;
  group.add(roof);
  const roofTex = roofMat.map;
  if (roofTex) roofTex.repeat.set(1.6, 1.3);

  // ridge beam
  group.add(box(0.34, 0.32, 11.8, timber, 0, 16.85, 0));

  // eaves trim
  for (const side of [-1, 1]) {
    const eave = box(15.4, 0.28, 0.34, timber, 0, 10.92, side * 5.6);
    group.add(eave);
  }

  /* front and back gable walls */
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-7.5, 0);
  gableShape.lineTo(7.5, 0);
  gableShape.lineTo(0, 6.0);
  gableShape.lineTo(-7.5, 0);
  const gableGeo = new THREE.ShapeGeometry(gableShape);
  const frontGable = new THREE.Mesh(gableGeo, plaster);
  frontGable.position.set(0, 10.8, 5.68);
  frontGable.castShadow = true;
  group.add(frontGable);
  const backGable = new THREE.Mesh(gableGeo, plaster);
  backGable.position.set(0, 10.8, -5.68);
  backGable.rotation.y = Math.PI;
  group.add(backGable);

  /* gable timber pattern */
  const gableBeams = new THREE.Group();
  gableBeams.position.set(0, 10.8, 5.76);
  gableBeams.add(box(14.6, 0.22, 0.2, timber, 0, 0.1, 0));
  gableBeams.add(box(0.24, 5.9, 0.2, timber, 0, 2.9, 0));
  for (const s of [-1, 1]) {
    for (let i = 1; i <= 2; i++) {
      const len = 3.4 + i * 1.45;
      const b = box(0.18, len, 0.18, timber, s * (1.8 + i * 1.35), 2.4 - i * 0.25, 0);
      b.rotation.z = s * 0.62;
      gableBeams.add(b);
    }
  }
  group.add(gableBeams);

  /* dormers piercing the front slope */
  const slopeY = (z) => 16.8 - (z / 5.7) * 6.0;
  for (const dx of [-4.7, 0, 4.7]) {
    const dz = 2.9;
    const dormer = new THREE.Group();
    dormer.position.set(dx, slopeY(dz + 0.4) - 0.6, dz + 0.4);
    dormer.add(box(1.8, 1.5, 1.5, plasterDark, 0, 0.75, 0));
    const dormerRoof = new THREE.Mesh(gableGeometry(2.2, 1.2, 1.8), roofMat);
    dormerRoof.position.y = 1.48;
    dormerRoof.castShadow = true;
    dormerRoof.receiveShadow = true;
    dormer.add(dormerRoof);
    const dormerWin = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.9), basic(PALETTE.window));
    dormerWin.position.set(0, 0.72, 0.76);
    dormer.add(dormerWin);
    for (const s of [-1, 1]) {
      dormer.add(box(0.14, 1.5, 0.14, timber, s * 0.86, 0.75, 0.72));
    }
    dormer.add(box(1.95, 0.3, 1.7, timber, 0, 0.06, 0));
    addGlowSprite(dormer, 0xffb45c, 1.4, [0, 0.75, 0.95], 0.42);
    group.add(dormer);
  }

  /* front wall timbering */
  const facade = new THREE.Group();
  const fz = 4.53;
  for (const x of [-6.2, -4.1, -2.05, 2.05, 4.1, 6.2]) {
    facade.add(box(0.18, 5.1, 0.16, timber, x, 4.4, fz));
  }
  for (const y of [2.05, 3.35, 6.8]) {
    facade.add(box(12.9, 0.17, 0.16, timber, 0, y, fz));
  }
  for (const s of [-1, 1]) {
    const brace = box(0.16, 3.2, 0.14, timber, s * 5.2, 5.1, fz);
    brace.rotation.z = s * 0.7;
    facade.add(brace);
  }
  group.add(facade);

  /* side timbering */
  for (const side of [-1, 1]) {
    const x = side * 6.52;
    const sg = new THREE.Group();
    for (const z of [-3, 0, 3]) {
      sg.add(box(0.16, 5.0, 0.2, timber, x, 4.4, z));
    }
    sg.add(box(0.16, 0.18, 8.7, timber, x, 2.0, 0));
    sg.add(box(0.16, 0.18, 8.7, timber, x, 6.8, 0));
    group.add(sg);
  }

  /* porch */
  const porch = new THREE.Group();
  const deck = box(8.6, 0.35, 3.4, toon(PALETTE.woodLight, { map: woodTexture() }), 0, 0.7, 6.35);
  porch.add(deck);
  for (let i = 0; i < 3; i++) {
    porch.add(box(7.4 - i * 0.2, 0.22, 0.9, stoneDark, 0, 0.22 + i * 0.22, 8.35 + i * 0.22));
  }
  for (const x of [-3.7, -1.25, 1.25, 3.7]) {
    porch.add(box(0.24, 4.2, 0.24, timber, x, 2.9, 7.55));
    const brace = box(0.16, 1.1, 0.14, timber, x + Math.sign(x) * 0.4, 4.65, 7.55);
    brace.rotation.z = Math.sign(x) * 0.78;
    porch.add(brace);
  }
  // porch gable roof
  const porchRoof = new THREE.Mesh(gableGeometry(9.6, 2.4, 3.8), roofMat);
  porchRoof.position.set(0, 5.0, 6.35);
  porchRoof.castShadow = true;
  porch.add(porchRoof);
  // railing
  for (const side of [-1, 1]) {
    porch.add(box(2.2, 0.1, 0.1, timber, side * 3.1, 1.5, 7.6));
    porch.add(box(0.1, 0.8, 0.1, timber, side * 2.1, 1.1, 7.6));
    porch.add(box(0.1, 0.8, 0.1, timber, side * 4.0, 1.1, 7.6));
  }
  group.add(porch);

  /* door */
  const doorG = new THREE.Group();
  doorG.position.set(0, 3.05, 4.8);
  doorG.add(box(2.5, 4.2, 0.18, timber, 0, 0, 0));
  const door = box(1.9, 3.4, 0.16, toon(0x3d2c20, { map: woodTexture() }), 0, -0.15, 0.12);
  doorG.add(door);
  const arch = new THREE.Mesh(new THREE.CircleGeometry(0.98, 16, 0, Math.PI), toon(0x3d2c20));
  arch.position.set(0, 1.55, 0.14);
  doorG.add(arch);
  const doorLight = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.7), basic(PALETTE.window));
  doorLight.position.set(0, -0.3, 0.21);
  doorLight.material.opacity = 0.32;
  doorLight.material.transparent = true;
  doorG.add(doorLight);
  doorG.add(box(0.1, 0.1, 0.1, toon(0xcaa04c), 0.65, -0.35, 0.3));
  group.add(doorG);

  const doorGlow = addGlowSprite(group, 0xffb45c, 4.2, [0, 3.0, 5.0], 0.5);

  /* windows */
  addWindow(group, { x: -4.3, y: 4.4, z: 4.72, w: 1.3, h: 1.7 });
  addWindow(group, { x: 4.3, y: 4.4, z: 4.72, w: 1.3, h: 1.7 });
  addWindow(group, { x: -3.7, y: 9.0, z: 4.92, w: 1.25, h: 1.7 });
  addWindow(group, { x: 0, y: 9.0, z: 4.92, w: 1.25, h: 1.7 });
  addWindow(group, { x: 3.7, y: 9.0, z: 4.92, w: 1.25, h: 1.7 });
  addWindow(group, { x: 0, y: 13.4, z: 5.79, w: 1.25, h: 1.9, attic: true });
  for (const side of [-1, 1]) {
    addWindow(group, { x: side * 6.73, y: 4.6, z: -2.6, ry: side * Math.PI / 2, w: 1.15, h: 1.5 });
    addWindow(group, { x: side * 6.73, y: 4.6, z: 2.0, ry: side * Math.PI / 2, w: 1.15, h: 1.5 });
    addWindow(group, { x: side * 6.73, y: 9.0, z: 0, ry: side * Math.PI / 2, w: 1.15, h: 1.4 });
  }
  addWindow(group, { x: 0, y: 4.4, z: -4.72, ry: Math.PI, w: 1.15, h: 1.5, glow: 0.5 });

  /* corner tower */
  const tower = new THREE.Group();
  tower.position.set(-5.3, 0, 4.7);
  const towerBody = box(3.8, 11.4, 3.8, plasterDark, 0, 5.7, 0);
  tower.add(towerBody);
  tower.add(box(4.2, 0.35, 4.2, timber, 0, 7.0, 0));
  tower.add(box(4.2, 0.3, 4.2, timber, 0, 10.2, 0));
  for (const x of [-1.75, 0, 1.75]) {
    tower.add(box(0.16, 10.9, 0.16, timber, x, 5.7, 1.92));
  }
  for (const y of [2.1, 4.0, 8.5]) {
    tower.add(box(3.7, 0.16, 0.16, timber, 0, y, 1.92));
  }
  const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(3.5, 4.4, 4), roofMat);
  towerRoof.position.set(0, 13.55, 0);
  towerRoof.rotation.y = Math.PI / 4;
  towerRoof.castShadow = true;
  tower.add(towerRoof);
  tower.add(box(0.16, 1.1, 0.16, iron, 0, 16.4, 0));
  addWindow(tower, { x: 0, y: 8.7, z: 1.94, w: 1.1, h: 1.5 });
  addWindow(tower, { x: 0, y: 4.6, z: 1.94, w: 1.1, h: 1.5 });
  addWindow(tower, { x: 1.94, y: 6.8, z: 0, ry: Math.PI / 2, w: 0.9, h: 1.2 });
  group.add(tower);

  /* chimney */
  const chimney = new THREE.Group();
  chimney.position.set(4.4, 0, -2.5);
  chimney.add(box(1.5, 6.5, 1.4, stone, 0, 13.2, 0));
  chimney.add(box(1.9, 0.3, 1.8, stoneDark, 0, 16.55, 0));
  chimney.add(box(1.1, 0.22, 1.0, toon(0x151311), 0, 16.75, 0));
  group.add(chimney);

  /* hanging lantern by door */
  const lanternGroup = new THREE.Group();
  lanternGroup.position.set(2.2, 5.3, 5.1);
  const chain = box(0.07, 1.1, 0.07, iron, 0, 0.55, 0);
  lanternGroup.add(chain);
  const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), basic(PALETTE.window));
  lantern.position.set(0, 0, 0);
  lanternGroup.add(lantern);
  lanternGroup.add(box(0.5, 0.12, 0.5, iron, 0, 0.34, 0));
  lanternGroup.add(box(0.5, 0.12, 0.5, iron, 0, -0.34, 0));
  group.add(lanternGroup);
  addGlowSprite(group, 0xffb055, 3.2, [2.2, 5.3, 5.3], 0.6);

  scene.add(group);
  mergeStatic(group);

  /* smoke puffs */
  const smokeTex = smokeTexture();
  const puffs = [];
  for (let i = 0; i < 7; i++) {
    const mat = new THREE.SpriteMaterial({
      map: smokeTex, color: 0xbfc4b8, transparent: true,
      opacity: 0.16, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.position.set(4.4 + (Math.random() - 0.5) * 0.6, 17.0 + Math.random() * 3, -2.5 + (Math.random() - 0.5) * 0.6);
    const base = s.position.clone();
    s.userData = { base, phase: Math.random() * 10, speed: 0.25 + Math.random() * 0.2, scale: 1.5 + Math.random() * 1.5 };
    s.scale.setScalar(s.userData.scale);
    scene.add(s);
    puffs.push(s);
  }

  return { group, doorGlow, puffs, chimneyWorld: new THREE.Vector3(4.4, 17, WORLD.houseZ - 2.5) };
}

/* ------------------------------------------------------------------ */
/*  Iron fence + gate                                                 */
/* ------------------------------------------------------------------ */
function createFence(scene) {
  const group = new THREE.Group();
  const iron = toon(PALETTE.iron);
  const stone = toon(PALETTE.stone, { map: stoneTexture() });
  const stoneDark = toon(PALETTE.stoneDark);

  const minX = -11.5, maxX = 11.5, minZ = -28, maxZ = -11;
  const gateHalf = 2.4;
  const barGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.75, 5);
  const tipGeo = new THREE.ConeGeometry(0.11, 0.3, 4);

  const bars = [];
  const step = 0.62;
  for (let x = minX; x <= maxX; x += step) {
    if (Math.abs(x) < gateHalf) continue;
    bars.push([x, maxZ]);
  }
  for (let x = minX; x <= maxX; x += step) bars.push([x, minZ]);
  for (let z = minZ; z <= maxZ; z += step) {
    bars.push([minX, z]);
    bars.push([maxX, z]);
  }

  const barMesh = new THREE.InstancedMesh(barGeo, iron, bars.length);
  const tipMesh = new THREE.InstancedMesh(tipGeo, iron, bars.length);
  barMesh.castShadow = true;
  const dummy = new THREE.Object3D();
  bars.forEach(([x, z], i) => {
    dummy.position.set(x, 1.55, z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    barMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 3.08, z);
    dummy.updateMatrix();
    tipMesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(barMesh, tipMesh);

  const postGeo = new THREE.BoxGeometry(0.46, 3.5, 0.46);
  const posts = [];
  for (let x = minX; x <= maxX; x += 4.95) posts.push([x, maxZ]);
  for (let x = minX; x <= maxX; x += 4.95) posts.push([x, minZ]);
  for (let z = minZ; z <= maxZ; z += 5.2) {
    posts.push([minX, z]);
    posts.push([maxX, z]);
  }
  const postMesh = new THREE.InstancedMesh(postGeo, stone, posts.length);
  postMesh.castShadow = true;
  const capGeo = new THREE.ConeGeometry(0.33, 0.42, 4);
  const capMesh = new THREE.InstancedMesh(capGeo, stoneDark, posts.length);
  posts.forEach(([x, z], i) => {
    dummy.position.set(x, 1.75, z);
    dummy.rotation.set(0, Math.PI / 4, 0);
    dummy.updateMatrix();
    postMesh.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 3.65, z);
    dummy.updateMatrix();
    capMesh.setMatrixAt(i, dummy.matrix);
  });
  group.add(postMesh, capMesh);

  // rails
  for (const side of [
    [minX, maxZ, -gateHalf, maxZ],
    [gateHalf, maxZ, maxX, maxZ],
    [minX, minZ, maxX, minZ],
    [minX, minZ, minX, maxZ],
    [maxX, minZ, maxX, maxZ],
  ]) {
    const [x0, z0, x1, z1] = side;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rail = box(len, 0.1, 0.09, iron, (x0 + x1) / 2, 2.55, (z0 + z1) / 2);
    rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    group.add(rail);
    const rail2 = rail.clone();
    rail2.position.y = 0.58;
    group.add(rail2);
  }

  // gate pillars + lanterns
  const lanternLights = [];
  for (const s of [-1, 1]) {
    const x = s * (gateHalf + 0.55);
    const pillar = box(1.2, 4.4, 1.2, stone, x, 2.2, maxZ);
    group.add(pillar);
    group.add(box(1.5, 0.3, 1.5, stoneDark, x, 4.5, maxZ));
    group.add(box(1.35, 0.25, 1.35, stoneDark, x, 3.3, maxZ));
    const lampPost = box(0.15, 1.1, 0.15, iron, x, 5.1, maxZ);
    group.add(lampPost);
    const lampBox = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.52), basic(PALETTE.window));
    lampBox.position.set(x, 5.95, maxZ);
    group.add(lampBox);
    group.add(box(0.68, 0.14, 0.68, iron, x, 5.58, maxZ));
    group.add(box(0.68, 0.14, 0.68, iron, x, 6.32, maxZ));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.45, 4), iron);
    cap.position.set(x, 6.6, maxZ);
    cap.rotation.y = Math.PI / 4;
    group.add(cap);
    addGlowSprite(group, 0xffb45f, 3.6, [x, 5.95, maxZ + 0.3], 0.6);

    const light = new THREE.PointLight(0xffa348, 32, 16, 2);
    light.position.set(x, 6.0, maxZ + 0.4);
    light.castShadow = false;
    scene.add(light);
    lanternLights.push(light);
  }

  // open iron gate doors
  for (const s of [-1, 1]) {
    const door = new THREE.Group();
    const hingeX = s * gateHalf;
    door.position.set(hingeX, 0, maxZ);
    door.rotation.y = s * 1.15;
    const w = gateHalf;
    for (const y of [0.7, 2.85]) {
      const bar = box(w - 0.1, 0.1, 0.08, iron, (w / 2) * -s, y, 0);
      door.add(bar);
    }
    for (let i = 0; i < 6; i++) {
      const x = -s * (0.25 + (i / 5) * (w - 0.5));
      door.add(box(0.06, 2.5, 0.06, iron, x, 1.5, 0));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.28, 4), iron);
      tip.position.set(x, 2.88, 0);
      door.add(tip);
    }
    const oval = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.045, 4, 14), iron);
    oval.position.set(-s * w * 0.72, 1.75, 0);
    oval.rotation.z = 0.1 * s;
    door.add(oval);
    group.add(door);
  }

  scene.add(group);
  mergeStatic(group);
  return { group, lanternLights };
}

/* ------------------------------------------------------------------ */
/*  Graveyard                                                         */
/* ------------------------------------------------------------------ */
function makeGravestone(rnd) {
  const g = new THREE.Group();
  const stone = toon(0x878778);
  const dark = toon(0x5d5d51);
  const type = rnd();
  if (type < 0.45) {
    const w = 0.7 + rnd() * 0.5, h = 0.9 + rnd() * 0.9;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.24), stone);
    slab.position.y = h / 2;
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.24, 12, 1, false, 0, Math.PI), stone);
    top.rotation.x = Math.PI / 2;
    top.rotation.z = Math.PI / 2;
    top.position.y = h;
    g.add(top);
    for (let i = 0; i < 3; i++) {
      const crack = box(0.03, 0.3 + rnd() * 0.4, 0.02, dark, (rnd() - 0.5) * w * 0.6, h * 0.45 + rnd() * 0.2, 0.13);
      crack.rotation.z = (rnd() - 0.5) * 0.5;
      g.add(crack);
    }
  } else if (type < 0.75) {
    const w = 0.26, h = 1.3 + rnd() * 0.6;
    g.add(box(w, h, 0.24, stone, 0, h / 2, 0));
    g.add(box(w * 2.6, 0.3, 0.24, stone, 0, h * 0.72, 0));
    g.add(box(0.5, 0.35, 0.5, dark, 0, 0.17, 0));
  } else {
    const h = 1.5 + rnd() * 0.6;
    const base = box(0.75, 0.3, 0.75, dark, 0, 0.15, 0);
    g.add(base);
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.32, h, 4), stone);
    obelisk.position.y = h / 2 + 0.3;
    obelisk.rotation.y = Math.PI / 4;
    obelisk.castShadow = true;
    g.add(obelisk);
  }
  // dirt mound
  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    toon(0x4b3b2a)
  );
  mound.scale.set(1, 0.18, 0.7);
  mound.position.set(0, 0.02, 0.65);
  mound.receiveShadow = true;
  g.add(mound);
  g.rotation.z = (rnd() - 0.5) * 0.14;
  g.rotation.y = (rnd() - 0.5) * 0.5;
  return g;
}

function createGraveyard(scene) {
  const rnd = mulberry32(1912);
  const g = new THREE.Group();
  const positions = [
    [-8.8, -13.2], [-6.2, -12.1], [7.6, -12.5], [9.4, -14.8],
    [-9.2, -18.5], [-9.6, -22.5], [9.0, -19.0], [9.6, -23.4],
    [-8.6, -26.0], [8.4, -26.2], [4.6, -12.8], [-4.4, -12.9],
    [-9.9, -16.0], [10.0, -16.2],
  ];
  positions.forEach(([x, z], i) => {
    const stone = makeGravestone(rnd);
    stone.position.set(x, 0, z);
    stone.rotation.y += 0.1;
    g.add(stone);
    if (i === 2 || i === 6) {
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.28, 6), toon(PALETTE.bone));
      candle.position.set(x + 0.6, 0.14, z + 0.3);
      g.add(candle);
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), basic(0xffc46a));
      flame.position.set(x + 0.6, 0.34, z + 0.3);
      g.add(flame);
      addGlowSprite(g, 0xffb45c, 1.2, [x + 0.6, 0.4, z + 0.3], 0.7);
    }
  });
  scene.add(g);
  mergeStatic(g);
  return g;
}

/* ------------------------------------------------------------------ */
/*  Trees, rocks, scrub                                               */
/* ------------------------------------------------------------------ */
function makeLeafyTree(rnd, scale = 1) {
  const g = new THREE.Group();
  const trunkMat = toon(0x4d3a2a);
  const h = (3.6 + rnd() * 2.5) * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.42 * scale, h, 6), trunkMat);
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.rotation.z = (rnd() - 0.5) * 0.12;
  g.add(trunk);

  // a couple of branches
  for (let i = 0; i < 2; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * scale, 0.16 * scale, h * 0.45, 5), trunkMat);
    b.position.set((rnd() - 0.5) * 0.8, h * 0.72, (rnd() - 0.5) * 0.8);
    b.rotation.z = (rnd() - 0.5) * 1.2;
    b.rotation.x = (rnd() - 0.5) * 0.8;
    b.castShadow = true;
    g.add(b);
  }

  const leafMats = [toon(PALETTE.leafA), toon(PALETTE.leafB), toon(PALETTE.leafC)];
  const clusters = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < clusters; i++) {
    const r = (0.7 + rnd() * 0.85) * scale;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), leafMats[i % 3]);
    const a = rnd() * Math.PI * 2;
    const rad = rnd() * 1.25 * scale;
    m.position.set(
      Math.cos(a) * rad,
      h * (0.72 + rnd() * 0.32),
      Math.sin(a) * rad
    );
    m.scale.set(1, 0.8 + rnd() * 0.3, 1);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

function makeDeadTree(rnd, scale = 1) {
  const g = new THREE.Group();
  const bark = toon(PALETTE.deadbark);
  const barkLight = toon(0x4d4438);

  function branch(parent, len, radius, depth, tiltX, tiltZ) {
    const geo = new THREE.CylinderGeometry(radius * 0.55, radius, len, 5);
    const mesh = new THREE.Mesh(geo, depth > 1 ? bark : barkLight);
    mesh.position.y = len / 2;
    mesh.castShadow = true;
    const pivot = new THREE.Group();
    pivot.rotation.x = tiltX;
    pivot.rotation.z = tiltZ;
    pivot.add(mesh);
    parent.add(pivot);
    if (depth > 0) {
      const kids = depth >= 2 ? 3 : 2;
      for (let i = 0; i < kids; i++) {
        const a = (i / kids) * Math.PI * 2 + rnd() * 0.8;
        const childPivot = new THREE.Group();
        childPivot.position.y = len * (0.55 + rnd() * 0.3);
        childPivot.rotation.y = a;
        pivot.add(childPivot);
        branch(childPivot, len * (0.55 + rnd() * 0.2), radius * 0.58, depth - 1, 0.5 + rnd() * 0.5, (rnd() - 0.5) * 0.6);
      }
    }
  }
  branch(g, 3.6 * scale, 0.3 * scale, 3, (rnd() - 0.5) * 0.15, (rnd() - 0.5) * 0.15);
  return g;
}

function makeRock(rnd) {
  const g = new THREE.Group();
  const mat = toon(0x6f7062);
  const mat2 = toon(0x858575);
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = 0.4 + rnd() * 0.9;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rnd() > 0.5 ? mat : mat2);
    rock.position.set((rnd() - 0.5) * 1.4, r * 0.35, (rnd() - 0.5) * 1.4);
    rock.scale.set(1, 0.55 + rnd() * 0.35, 1);
    rock.rotation.set(rnd(), rnd(), rnd());
    rock.castShadow = true;
    rock.receiveShadow = true;
    g.add(rock);
  }
  return g;
}

function makeBush(rnd) {
  const g = new THREE.Group();
  const mats = [toon(0x35552b), toon(0x476b35), toon(0x2c4825)];
  for (let i = 0; i < 3; i++) {
    const r = 0.45 + rnd() * 0.55;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mats[i]);
    b.position.set((rnd() - 0.5) * 0.9, r * 0.6, (rnd() - 0.5) * 0.9);
    b.scale.y = 0.75;
    b.castShadow = true;
    b.receiveShadow = true;
    g.add(b);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/*  Ritual circle                                                     */
/* ------------------------------------------------------------------ */
function createRitualCircle(scene) {
  const g = new THREE.Group();
  g.position.set(11.5, 0.03, -3.5);

  const slab = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.4, 0.18, 32), toon(0x5c5b50));
  slab.position.y = 0;
  slab.receiveShadow = true;
  g.add(slab);

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8f2a24, transparent: true, opacity: 0.8 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.55, 2.68, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.11;
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(1.68, 1.74, 40), ringMat);
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.11;
  g.add(ring2);

  const pts = [];
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    pts.push(new THREE.Vector3(Math.cos(a) * 2.5, 0.12, Math.sin(a) * 2.5));
  }
  const star = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color: 0xa6342b, transparent: true, opacity: 0.85 })
  );
  g.add(star);

  // candles
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    const x = Math.cos(a) * 3.0, z = Math.sin(a) * 3.0;
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.35 + (i % 2) * 0.1, 6), toon(PALETTE.bone));
    candle.position.set(x, 0.18, z);
    g.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), basic(0xffc46a));
    flame.position.set(x, 0.48, z);
    flame.scale.y = 1.6;
    g.add(flame);
    addGlowSprite(g, 0xff9b4a, 1.1, [x, 0.5, z], 0.65);
  }
  scene.add(g);
  mergeStatic(g);
  return g;
}

/* ------------------------------------------------------------------ */
/*  Windmill (distant landmark)                                       */
/* ------------------------------------------------------------------ */
function createWindmill(scene) {
  const group = new THREE.Group();
  const x = 25, z = -16;
  const stone = toon(0xb6b0a2, { map: stoneTexture() });
  const stoneDark = toon(0x7b7568);
  const wood = toon(PALETTE.wood);
  const roof = toon(PALETTE.roof);
  const canvasMat = toon(0x8d7c5c);

  /* tapered stone tower with banding */
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 2.6, 9.2, 9), stone);
  tower.position.y = 4.6;
  tower.castShadow = true;
  tower.receiveShadow = true;
  group.add(tower);

  // bands that hug the taper and read as protruding rings
  const towerRadius = (y) => 2.6 - (y / 9.2) * 1.05;
  for (const y of [2.4, 5.0, 7.6]) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(towerRadius(y) + 0.12, towerRadius(y) + 0.18, 0.28, 9),
      stoneDark
    );
    band.position.y = y;
    band.castShadow = true;
    group.add(band);
  }

  /* gallery deck under the cap */
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.3, 0.3, 9), wood);
  deck.position.y = 8.9;
  deck.castShadow = true;
  group.add(deck);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    group.add(box(0.12, 0.75, 0.12, wood, Math.cos(a) * 2.25, 9.35, Math.sin(a) * 2.25));
  }

  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.25, 2.6, 9), roof);
  cap.position.y = 10.6;
  cap.castShadow = true;
  group.add(cap);

  /* door */
  group.add(box(1.1, 2.1, 0.3, toon(0x3a2a1d), 0, 1.15, 2.35));
  group.add(box(1.35, 0.18, 0.35, stoneDark, 0, 2.3, 2.35));
  addGlowSprite(group, 0xffb45c, 2.0, [0, 1.7, 2.7], 0.4);

  /* windows */
  for (const y of [4.2, 6.6]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.8), basic(0xffb559));
    win.position.set(0, y, 2.28);
    group.add(win);
    group.add(box(0.82, 0.12, 0.12, wood, 0, y - 0.46, 2.32));
  }

  /* sail wheel tilted so it reads from the top-down camera */
  const wheel = new THREE.Group();
  wheel.position.set(0, 10.2, 2.9);
  wheel.rotation.x = -0.5;
  group.add(wheel);

  wheel.add(box(0.22, 0.22, 2.2, wood, 0, 0, 1.1));   // cruck beam
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.6, 8), wood);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);

  const blades = new THREE.Group();
  wheel.add(blades);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    arm.add(box(0.18, 4.4, 0.14, wood, 0, 2.2, 0));
    arm.add(box(1.15, 3.1, 0.06, canvasMat, 0.66, 2.5, 0.07));
    for (const yy of [1.2, 2.1, 3.0, 3.8]) {
      arm.add(box(1.15, 0.09, 0.09, wood, 0.66, yy, 0.12));
    }
    blades.add(arm);
  }
  blades.userData.noMerge = true;   // the sails keep turning

  group.position.set(x, 0, z);
  group.rotation.y = -0.7;
  scene.add(group);
  mergeStatic(group);
  return { group, blades };
}

/* ------------------------------------------------------------------ */
/*  Environment                                                       */
/* ------------------------------------------------------------------ */
export function createEnvironment(scene, renderer) {
  const rnd = mulberry32(4791);
  const updaters = [];
  const group = new THREE.Group();
  scene.add(group);

  /* sky & light */
  scene.background = new THREE.Color(0x263128);
  scene.fog = new THREE.FogExp2(0x9ba68d, 0.0045);

  const hemi = new THREE.HemisphereLight(0xc3d5bc, 0x2b3720, 1.0);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0x8fa28a, 0.22);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffe3b5, 2.9);
  sun.position.set(-20, 32, 18);
  // Broad, warm afternoon shadows keep enemies readable on the grass.
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 95;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  const rim = new THREE.DirectionalLight(0xa9c4c8, 0.82);
  rim.position.set(24, 18, -22);
  scene.add(rim);

  /* ground */
  const gTex = grassTexture();
  gTex.repeat.set(11, 11);
  const groundGeo = new THREE.PlaneGeometry(170, 170, 100, 100);
  groundGeo.rotateX(-Math.PI / 2);
  const colors = [];
  const p = groundGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const n = Math.sin(x * 0.18) * Math.cos(z * 0.14) * 0.5
      + Math.sin(x * 0.47 + z * 0.31) * 0.25
      + Math.cos(z * 0.09 - x * 0.12) * 0.25;
    const v = 0.94 + n * 0.09;
    colors.push(v * 0.93, v, v * 0.87);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const groundMat = new THREE.MeshToonMaterial({
    map: gTex,
    vertexColors: true,
    color: 0xe6eed6,
    gradientMap: toon(0xffffff).gradientMap,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'ground';
  ground.receiveShadow = true;
  scene.add(ground);

  // dark clearing under the graveyard
  const clearingTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(46,43,30,.55)');
    grd.addColorStop(0.55, 'rgba(46,43,30,.4)');
    grd.addColorStop(1, 'rgba(46,43,30,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const clearing = new THREE.Mesh(
    new THREE.PlaneGeometry(27, 20),
    new THREE.MeshBasicMaterial({ map: clearingTex, transparent: true, opacity: 0.66, depthWrite: false })
  );
  clearing.rotation.x = -Math.PI / 2;
  clearing.position.set(0, 0.035, -19);
  scene.add(clearing);

  /* paths & water */
  createPaths(scene);
  const water = createWater(
    [[-25, -38], [-24.4, -26], [-23.2, -14], [-23.5, -4], [-22.8, 6], [-23.5, 16], [-22.5, 26], [-23.5, 38]],
    [4.4, 4.8, 6.3, 8.5, 7.2, 5.2, 4.6, 4.2],
    scene
  );
  updaters.push((dt, t) => { water.uniforms.uTime.value = t; });
  const bank = ribbonGeometry(
    [[-25, -38], [-24.4, -26], [-23.2, -14], [-23.5, -4], [-22.8, 6], [-23.5, 16], [-22.5, 26], [-23.5, 38]],
    [6.3, 6.8, 8.5, 10.6, 9.2, 7.2, 6.5, 6.0],
    110
  );
  const bankMat = toon(0x4b4a35);
  bankMat.side = THREE.DoubleSide;
  const bankMesh = new THREE.Mesh(bank.geo, bankMat);
  bankMesh.name = 'bank';
  bankMesh.position.y = 0.015;
  bankMesh.receiveShadow = true;
  scene.add(bankMesh);
  createBridge(scene);

  // Low planted beds frame the farm without introducing solid obstacles.
  const beds = new THREE.Group();
  scene.add(beds);
  const soil = toon(0x635238);
  for (let row = 0; row < 6; row++) {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(8, 0.07, 0.65), soil);
    bed.position.set(17, 0.03, 8 + row * 1.3);
    bed.receiveShadow = true;
    beds.add(bed);
  }
  const crops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.17, 0.65, 5), toon(0x9aab61), 108);
  const cropTransform = new THREE.Object3D();
  for (let row = 0; row < 6; row++) {
    for (let plant = 0; plant < 18; plant++) {
      cropTransform.position.set(13.3 + plant * 0.43, 0.36, 8 + row * 1.3);
      cropTransform.rotation.set(0, plant * 1.7, 0.12 * Math.sin(plant + row));
      cropTransform.updateMatrix();
      crops.setMatrixAt(row * 18 + plant, cropTransform.matrix);
    }
  }
  crops.receiveShadow = true;
  beds.add(crops);
  mergeStatic(beds);

  // lily pads (instanced)
  const padMat = toon(0x4d7a3b);
  const padDummy = new THREE.Object3D();
  const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 7), padMat, 12);
  for (let i = 0; i < 12; i++) {
    const r = 0.2 + rnd() * 0.35;
    const side = rnd() > 0.5 ? 1 : -1;
    padDummy.position.set(-23 + side * (1.5 + rnd() * 3.2), 0.075, -8 + rnd() * 16);
    padDummy.rotation.set(-Math.PI / 2, 0, rnd() * 6.28);
    padDummy.scale.setScalar(r);
    padDummy.updateMatrix();
    pads.setMatrixAt(i, padDummy.matrix);
  }
  pads.instanceMatrix.needsUpdate = true;
  scene.add(pads);

  /* house, fence, graveyard */
  const house = createHouse(scene);
  const fence = createFence(scene);
  createGraveyard(scene);
  createRitualCircle(scene);
  const windmill = createWindmill(scene);

  const lanternLights = fence.lanternLights;
  const porchLight = new THREE.PointLight(0xffa64d, 26, 15, 2);
  porchLight.position.set(0, 4.4, WORLD.houseZ + 5.7);
  scene.add(porchLight);
  lanternLights.push(porchLight);

  // warm interior glow behind windows (a single soft light)
  const interior = new THREE.PointLight(0xff9540, 20, 13, 2);
  interior.position.set(0, 7.2, WORLD.houseZ + 1.5);
  scene.add(interior);
  lanternLights.push(interior);

  /* scatter */
  const pathLines = [
    [[0, -11.4], [-0.4, -7], [-1.8, 1], [1.2, 11], [0.2, 20], [-2.5, 31]],
    [[0.8, 10], [6, 8.5], [13, 6.2], [19, 3.4], [24, -2], [26, -8]],
  ];
  const nearPath = (x, z, margin = 4) => {
    for (const line of pathLines) {
      for (let i = 0; i < line.length - 1; i++) {
        if (distanceToSegment(x, z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]) < margin) return true;
      }
    }
    return false;
  };

  const blocked = (x, z) => {
    if (Math.abs(x) < 16 && z < -8 && z > -31) return true; // estate
    if (x > 6 && x < 17 && z > -8 && z < 3) return true; // ritual circle
    if (x < -15 && z < 12 && z > -30) return true; // stream
    if (nearPath(x, z, 6.2)) return true;
    if (Math.abs(x) < 8 && z > -6 && z < 24) return true;
    if (Math.abs(x) > 31 || Math.abs(z) > 33) return false;
    return false;
  };

  const treeSpots = [];
  let guard = 0;
  while (treeSpots.length < 20 && guard++ < 1200) {
    const x = (rnd() - 0.5) * 74;
    const z = (rnd() - 0.5) * 76 - 2;
    if (blocked(x, z)) continue;
    if (treeSpots.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 5.2)) continue;
    treeSpots.push([x, z]);
  }
  for (const [x, z] of treeSpots) {
    const tree = makeLeafyTree(rnd, 0.68 + rnd() * 0.5);
    tree.position.set(x, 0, z);
    tree.rotation.y = rnd() * 6.28;
    group.add(tree);
  }
  // deliberate framing trees (never on the lane)
  for (const [x, z, s] of [[-17, 6, 1.05], [18, 10, 1.0], [-16, 22, 0.9], [19, 25, 0.95], [-18, -4, 0.95], [17, -3, 1.0]]) {
    const tree = makeLeafyTree(rnd, s);
    tree.position.set(x, 0, z);
    tree.rotation.y = rnd() * 6.28;
    group.add(tree);
  }

  // dead trees near the manor
  for (const [x, z, s] of [[-15, -19, 1.15], [14.5, -20, 1.0], [-17, -6, 0.9], [16, -11, 1.05], [-13.5, -27, 1.1]]) {
    const tree = makeDeadTree(rnd, s);
    tree.position.set(x, 0, z);
    tree.rotation.y = rnd() * 6.28;
    group.add(tree);
  }

  // bushes + rocks
  for (let i = 0; i < 14; i++) {
    const x = (rnd() - 0.5) * 68, z = (rnd() - 0.5) * 70;
    if (blocked(x, z)) continue;
    const bush = makeBush(rnd);
    bush.position.set(x, 0, z);
    bush.scale.setScalar(0.8 + rnd() * 0.3);
    group.add(bush);
  }
  for (let i = 0; i < 16; i++) {
    const x = (rnd() - 0.5) * 66, z = (rnd() - 0.5) * 68;
    if (blocked(x, z)) continue;
    const rock = makeRock(rnd);
    rock.position.set(x, 0, z);
    group.add(rock);
  }
  // stones lining the stream
  for (let i = 0; i < 20; i++) {
    const z = -30 + i * 3.2;
    const x = -29.5 + Math.sin(i * 0.9) * 1.6;
    const rock = makeRock(rnd);
    rock.position.set(x, 0, z);
    rock.scale.setScalar(0.45 + rnd() * 0.35);
    group.add(rock);
  }

  // grass tufts (instanced, tinted per tuft)
  const tuftGeo = new THREE.ConeGeometry(0.09, 0.55, 3);
  tuftGeo.translate(0, 0.27, 0);
  const tuftMat = toon(0x6f9650);
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 900);
  const dummy = new THREE.Object3D();
  const tcol = new THREE.Color();
  let ti = 0, tries = 0;
  while (ti < 900 && tries++ < 4200) {
    const x = (rnd() - 0.5) * 70, z = (rnd() - 0.5) * 72;
    if (blocked(x, z)) continue;
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, rnd() * 6.28, (rnd() - 0.5) * 0.25);
    dummy.scale.setScalar(0.7 + rnd() * 1.2);
    dummy.updateMatrix();
    tufts.setMatrixAt(ti, dummy.matrix);
    tcol.setHSL(0.24 + rnd() * 0.08, 0.3 + rnd() * 0.22, 0.3 + rnd() * 0.16);
    tufts.setColorAt(ti, tcol);
    ti++;
  }
  tufts.count = ti;
  if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
  tufts.receiveShadow = true;
  group.add(tufts);

  // reeds along the stream
  const reedGeo = new THREE.ConeGeometry(0.05, 1.5, 3);
  reedGeo.translate(0, 0.75, 0);
  const reeds = new THREE.InstancedMesh(reedGeo, toon(0x47663f), 90);
  let ri = 0;
  for (let i = 0; i < 90; i++) {
    const z = -32 + rnd() * 64;
    const x = -25 + (rnd() - 0.5) * 4.6;
    dummy.position.set(x, 0.05, z);
    dummy.rotation.set((rnd() - 0.5) * 0.35, rnd() * 6.28, (rnd() - 0.5) * 0.35);
    dummy.scale.setScalar(0.7 + rnd() * 0.9);
    dummy.updateMatrix();
    reeds.setMatrixAt(ri++, dummy.matrix);
  }
  reeds.count = ri;
  group.add(reeds);

  // moss and dead-leaf patches on the ground
  const mossTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const grd = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grd.addColorStop(0, 'rgba(58,52,32,.7)');
    grd.addColorStop(0.6, 'rgba(52,48,30,.42)');
    grd.addColorStop(1, 'rgba(52,48,30,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  const moss = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 12),
    new THREE.MeshBasicMaterial({ map: mossTex, transparent: true, opacity: 0.55, depthWrite: false }),
    22
  );
  for (let i = 0; i < 22; i++) {
    let mx, mz, ok = false;
    for (let k = 0; k < 20; k++) {
      mx = (rnd() - 0.5) * 66; mz = (rnd() - 0.5) * 68;
      if (!blocked(mx, mz)) { ok = true; break; }
    }
    if (!ok) { mx = 14; mz = 18; }
    dummy.position.set(mx, 0.045, mz);
    dummy.rotation.set(-Math.PI / 2, 0, rnd() * 6.28);
    dummy.scale.setScalar(2.2 + rnd() * 3.8);
    dummy.updateMatrix();
    moss.setMatrixAt(i, dummy.matrix);
  }
  group.add(moss);

  // flowers
  const flowerGeo = new THREE.IcosahedronGeometry(0.075, 0);
  const flowerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, 220);
  const fcol = new THREE.Color();
  for (let i = 0; i < 220; i++) {
    let x, z, ok = false;
    for (let k = 0; k < 20; k++) {
      x = (rnd() - 0.5) * 66; z = (rnd() - 0.5) * 68;
      if (!blocked(x, z)) { ok = true; break; }
    }
    if (!ok) { x = 12; z = 14; }
    dummy.position.set(x, 0.18 + rnd() * 0.12, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(0.8 + rnd() * 0.9);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
    fcol.set(rnd() > 0.4 ? 0xf2ecd6 : 0xe9ce78);
    flowers.setColorAt(i, fcol);
  }
  group.add(flowers);

  /* background forest */
  const bgTreeMat = toon(0x26382a);
  const bgTrunkMat = toon(0x2a2a22);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2 + rnd() * 0.1;
    const r = 44 + rnd() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 8 + rnd() * 10;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.55, h * 0.5, 5), bgTrunkMat);
    trunk.position.set(x, h * 0.25, z);
    group.add(trunk);
    const crown = new THREE.Mesh(new THREE.ConeGeometry(2.8 + rnd() * 2.5, h, 7), bgTreeMat);
    crown.position.set(x, h * 0.55 + h * 0.35, z);
    crown.rotation.y = rnd() * 6;
    group.add(crown);
  }

  // bake the scatter into a handful of batches; the instanced tufts stay live
  mergeStatic(group);

  /* fog banks */
  const fogTex = smokeTexture();
  const fogs = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.SpriteMaterial({
      map: fogTex, color: 0xc9d2c2, transparent: true,
      opacity: 0.055 + rnd() * 0.04, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    const x = (rnd() - 0.5) * 70;
    const z = (rnd() - 0.5) * 70;
    s.position.set(x, 1.2 + rnd() * 2.4, z);
    s.scale.set(18 + rnd() * 20, 7 + rnd() * 6, 1);
    s.userData = { baseX: x, baseZ: z, phase: rnd() * 10, speed: 0.08 + rnd() * 0.08 };
    scene.add(s);
    fogs.push(s);
  }

  /* fireflies */
  const ffCount = 90;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(ffCount * 3);
  const ffData = [];
  for (let i = 0; i < ffCount; i++) {
    const x = (rnd() - 0.5) * 56;
    const z = (rnd() - 0.5) * 56;
    const y = 0.5 + rnd() * 3.2;
    ffPos[i * 3] = x; ffPos[i * 3 + 1] = y; ffPos[i * 3 + 2] = z;
    ffData.push({ x, y, z, p: rnd() * 10, s: 0.4 + rnd() * 1.1 });
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({
    size: 0.22,
    map: null,
    color: 0xd7e6a8,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  // point sprite map
  {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(220,255,170,.8)');
    grd.addColorStop(1, 'rgba(160,220,120,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    ffMat.map = t;
    ffMat.needsUpdate = true;
  }
  const fireflies = new THREE.Points(ffGeo, ffMat);
  scene.add(fireflies);

  /* lantern flicker + ambient updates */
  const flickerBase = lanternLights.map((l) => l.intensity);
  updaters.push((dt, t) => {
    for (let i = 0; i < lanternLights.length; i++) {
      lanternLights[i].intensity = flickerBase[i] * (0.9 + Math.sin(t * (7 + i) + i * 2.1) * 0.04 + Math.sin(t * 13.7 + i) * 0.03);
    }
    // chimney smoke
    for (const s of house.puffs) {
      const u = s.userData;
      const age = ((t * u.speed + u.phase * 0.13) % 1.6) / 1.6;
      s.position.set(
        u.base.x + Math.sin(t * 0.4 + u.phase) * 0.5 + age * 1.4,
        u.base.y + age * 7,
        u.base.z + Math.cos(t * 0.3 + u.phase) * 0.4
      );
      s.scale.setScalar(u.scale * (0.6 + age * 2.2));
      s.material.opacity = 0.16 * (1 - age) * (0.4 + age);
    }
    // gate glow pulse
    house.doorGlow.material.opacity = 0.42 + Math.sin(t * 1.4) * 0.06;

    // fog drift
    for (const s of fogs) {
      const u = s.userData;
      s.position.x = u.baseX + Math.sin(t * u.speed + u.phase) * 4.5;
      s.position.z = u.baseZ + Math.cos(t * u.speed * 1.3 + u.phase) * 3;
      s.material.opacity = 0.1 + Math.sin(t * 0.24 + u.phase) * 0.035;
    }

    // fireflies
    const pos = fireflies.geometry.attributes.position;
    for (let i = 0; i < ffCount; i++) {
      const d = ffData[i];
      pos.setXYZ(
        i,
        d.x + Math.sin(t * 0.45 * d.s + d.p) * 1.6,
        d.y + Math.sin(t * 0.8 * d.s + d.p * 2.0) * 0.5,
        d.z + Math.cos(t * 0.38 * d.s + d.p) * 1.6
      );
    }
    pos.needsUpdate = true;

    // windmill
    windmill.blades.rotation.z -= dt * 0.35;
  });

  return {
    group,
    update: (dt, t) => updaters.forEach((fn) => fn(dt, t)),
    house,
    housePosition: new THREE.Vector3(0, 0, WORLD.houseZ),
    gatePosition: new THREE.Vector3(0, 0, WORLD.gateZ),
    spawnPoints: WORLD.spawnPoints,
    lanternLights,
    sun,
  };
}
