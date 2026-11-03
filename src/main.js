import * as THREE from 'three';
import { createEnvironment } from './world/environment.js';
import { createSurvivor, createZombie } from './world/characters.js';
import { Effects, createTurretMesh, createCrateMesh, createPickupMesh, createFireZone } from './world/effects.js';
import { Env, CFG, COMBAT, MOVE_DIRS, WEAPONS, PERKS, PERK_NAMES, tacticalControl, UTILITY_NAMES, OBS_SIZE, ACTION_HEADS } from './sim/env.js';
import { PPOAgent } from './sim/ppo.js';

/* ------------------------------------------------------------------ */
/*  DOM                                                                */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const loader = $('loader');
const loaderSub = $('loader-sub');
const hud = $('hud');
const hitFlash = $('hit-flash');
const resultScreen = $('result-screen');
const rewardCanvas = $('reward-canvas');
const toastEl = $('toast');

function toast(text, ms = 2200) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

let bannerTimer = null;
function banner(kicker, text) {
  const el = $('mode-banner');
  $('banner-kicker').textContent = kicker;
  $('banner-text').textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 3300);
}

function setLoader(text) {
  if (loaderSub) loaderSub.textContent = text;
}

/* ------------------------------------------------------------------ */
/*  Renderer / scene                                                  */
/* ------------------------------------------------------------------ */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
} catch (err) {
  setLoader('WEBGL UNAVAILABLE — ' + err.message);
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.LinearToneMapping;
renderer.toneMappingExposure = 1.16;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 220);
const CAM_TARGET = new THREE.Vector3(0, 0, -7);
const cameraBase = new THREE.Vector3(0, 46, 28);
camera.position.copy(cameraBase).multiplyScalar(1.22);
camera.lookAt(CAM_TARGET);

setLoader('RAISING THE GROVE…');
const world = createEnvironment(scene, renderer);
const effects = new Effects(scene);

const survivor = createSurvivor();
survivor.group.scale.setScalar(1.12);
scene.add(survivor.group);

/* aim reticle for manual play */
const reticle = new THREE.Group();
{
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 20),
    new THREE.MeshBasicMaterial({
      color: 0xd8ab63, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  reticle.add(ring);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.09, 12),
    new THREE.MeshBasicMaterial({ color: 0xf1cc89, transparent: true, opacity: 0.8, depthWrite: false })
  );
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.01;
  reticle.add(dot);
  reticle.visible = false;
  scene.add(reticle);
}

/* ------------------------------------------------------------------ */
/*  Simulation                                                        */
/* ------------------------------------------------------------------ */
let env = new Env({ seed: (Date.now() % 100000) | 0, events: true });
survivor.group.position.set(env.agent.x, 0, env.agent.z);

let mode = 'watch'; // watch | play | observe
let followFarmer = false;
let training = false;
let policyReady = true; // the PPO core controls Mara from the first frame
let workerStarted = false;
let metrics = null;
let savedIteration = 0;
let rewardHistory = [];
let waveHistory = [];
let baseline = null;
let evaluation = null;
let evaluationHistory = [];
let resultShown = false;
let resultTimer = null;

/* Episode bookkeeping. An episode is the whole defence: waves escalate inside
   it, and it ends only when Mara falls or the house does. */
let visibleWavesHeld = 0;  // best defence sustained by the visible agent
let coreWaves = 0;         // waves held by the training core
let coreBestWave = 0;

let policy = new PPOAgent();
const STORE_KEY = 'hollow-grove-ppo-v8'; // New observation and action schema; v7 checkpoints remain untouched.

let worker = null;
let noteText = 'Training runs headless in a web worker.';

const keys = new Set();
const mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, left: false, right: false };
let manualAim = 0;
let manualAimPoint = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/* visual registries */
const zombieViews = new Map();
const corpses = [];
const turretViews = new Map();
const crateViews = new Map();
const pickupViews = new Map();
const fireViews = new Map();

let lastAction = { move: 0, combat: 0 };
let decisionTimer = 0;
let survivorFireT = 0;
let shakeT = 0;
let shakeMag = 0;
let screenFlash = 0;
let introT = 0;
let hudTimer = 0;
let saveTimer = 0;
let prevAgent = new THREE.Vector3(env.agent.x, 0, env.agent.z);
let lastTick = performance.now();
let elapsed = 0;
let debugCam = null;

/* ------------------------------------------------------------------ */
/*  Audio                                                             */
/* ------------------------------------------------------------------ */
class AudioFX {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.wind = null;
  }
  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled) this.ensure();
    const btn = $('btn-sound');
    btn.textContent = this.enabled ? 'SOUND: ON' : 'SOUND: OFF';
    if (this.wind) this.wind.gain.gain.setTargetAtTime(this.enabled ? 0.035 : 0, this.ctx.currentTime, 0.4);
    if (this.enabled) this.ui();
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // wind bed
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 320;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filt).connect(gain).connect(this.master);
    src.start();
    this.wind = { src, filt, gain };
  }
  noise(dur = 0.15, freq = 1200, gain = 0.3, type = 'bandpass', q = 1, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 1;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
  tone(freq = 440, dur = 0.2, gain = 0.1, type = 'sine', slide = 0, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  pistol() { this.noise(0.1, 1800, 0.28, 'bandpass', 0.8); this.tone(160, 0.08, 0.14, 'square', -80); }
  shotgun() { this.noise(0.28, 800, 0.42, 'lowpass', 1); this.tone(90, 0.22, 0.18, 'sawtooth', -45); }
  explosion() { this.noise(0.7, 260, 0.5, 'lowpass', 0.8); this.tone(55, 0.5, 0.25, 'sine', -20); }
  hurt() { this.tone(90, 0.24, 0.2, 'square', -40); this.noise(0.2, 500, 0.22, 'lowpass', 0.7); }
  kill() { this.noise(0.25, 700, 0.18, 'lowpass', 1.2); this.tone(70, 0.12, 0.08, 'triangle', -20); }
  build() { this.noise(0.08, 900, 0.3, 'bandpass', 1.4); this.tone(260, 0.12, 0.08, 'triangle', 80, 0.09); }
  crate() { this.tone(660, 0.15, 0.08, 'sine', 180); this.tone(990, 0.2, 0.05, 'sine', 120, 0.08); }
  rifle() { this.noise(0.14, 2400, 0.24, 'bandpass', 1.1); this.tone(210, 0.1, 0.12, 'square', -60); }
  reload() { this.noise(0.06, 1200, 0.14, 'bandpass', 1.2); this.tone(320, 0.06, 0.05, 'triangle', 40, 0.07); }
  dry() { this.noise(0.05, 3200, 0.08, 'highpass', 0.8); this.tone(420, 0.04, 0.03, 'square', 0); }
  swap() { this.noise(0.07, 900, 0.14, 'bandpass', 1.2); this.tone(300, 0.07, 0.05, 'triangle', 90, 0.06); }
  pickup() { this.tone(760, 0.12, 0.06, 'sine', 140); this.tone(1120, 0.16, 0.04, 'sine', 90, 0.07); }
  medkit() { this.tone(520, 0.2, 0.08, 'sine', 60); this.tone(780, 0.3, 0.05, 'sine', 120, 0.12); }
  perk() { this.tone(440, 0.35, 0.08, 'triangle', 0); this.tone(660, 0.4, 0.06, 'sine', 0, 0.1); this.tone(880, 0.5, 0.045, 'sine', 0, 0.22); }
  wave() { this.tone(110, 1.2, 0.13, 'sawtooth', 0); this.tone(165, 1.1, 0.09, 'sawtooth', -10, 0.06); }
  hold() { this.tone(330, 0.5, 0.1, 'triangle', 0); this.tone(495, 0.4, 0.07, 'sine', 0, 0.12); this.tone(660, 0.55, 0.05, 'sine', 0, 0.24); }
  hit() { this.noise(0.05, 2600, 0.1, 'highpass', 1); }
  turret() { this.noise(0.07, 2100, 0.12, 'bandpass', 1.4); }
  dash() { this.noise(0.24, 500, 0.12, 'bandpass', 0.8); }
  ui() { this.tone(520, 0.05, 0.035, 'triangle', 60); }
}
const audio = new AudioFX();

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function disposeGroup(group) {
  const geos = new Set();
  group.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
  });
  for (const g of geos) g.dispose();
  if (group.parent) group.parent.remove(group);
}

function clearVisuals() {
  for (const [, v] of zombieViews) disposeGroup(v.group);
  zombieViews.clear();
  for (const c of corpses) disposeGroup(c.char.group);
  corpses.length = 0;
  for (const [, v] of turretViews) disposeGroup(v.group);
  turretViews.clear();
  for (const [, v] of crateViews) disposeGroup(v.group);
  crateViews.clear();
  for (const [, v] of pickupViews) disposeGroup(v.group);
  pickupViews.clear();
  for (const [, v] of fireViews) disposeGroup(v.group);
  fireViews.clear();
}

function spawnShake(mag, t = 0.2) {
  shakeMag = Math.max(shakeMag, mag);
  shakeT = Math.max(shakeT, t);
}

function flashScreen(amount = 0.55) {
  screenFlash = Math.max(screenFlash, amount);
}

/* ------------------------------------------------------------------ */
/*  Entity visuals                                                    */
/* ------------------------------------------------------------------ */
function newZombieView(z) {
  const char = createZombie(z.variant, { brute: z.type === 'brute' });
  char.group.position.set(z.x, 0, z.z);
  char.group.rotation.y = Math.atan2(env.agent.x - z.x, env.agent.z - z.z);
  scene.add(char.group);
  return char;
}

function syncZombies(dt, t) {
  const seen = new Set();
  for (const z of env.zombies) {
    seen.add(z.id);
    let v = zombieViews.get(z.id);
    if (!v) {
      v = newZombieView(z);
      zombieViews.set(z.id, v);
    }
    v.group.position.x = z.x;
    v.group.position.z = z.z;
    let tx, tz;
    if (z.aggro) { tx = env.agent.x; tz = env.agent.z; }
    else if (z.z > -9.2) { tx = 0; tz = -9.6; }
    else { tx = CFG.doorX; tz = CFG.doorZ; }
    const desired = Math.atan2(tx - z.x, tz - z.z);
    v.group.rotation.y += angleDiff(desired, v.group.rotation.y) * Math.min(1, dt * 5.5);
    v.update(dt, t, { speed: z.speed, dead: false });
    if (z.flash > 0) v.flash();
  }

  for (const [id, v] of zombieViews) {
    if (seen.has(id)) continue;
    v.die();
    corpses.push({ char: v, age: 0 });
    zombieViews.delete(id);
  }
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i];
    c.age += dt;
    c.char.update(dt, t, { dead: true });
    if (c.age > 3.3) {
      disposeGroup(c.char.group);
      corpses.splice(i, 1);
    }
  }
}

function syncTurrets(dt, t) {
  const seen = new Set();
  for (const tur of env.turrets) {
    seen.add(tur.id);
    let v = turretViews.get(tur.id);
    if (!v) {
      const mesh = createTurretMesh();
      mesh.group.position.set(tur.x, 0, tur.z);
      mesh.group.scale.setScalar(0.01);
      scene.add(mesh.group);
      v = { ...mesh, pop: 0 };
      turretViews.set(tur.id, v);
      effects.dust(new THREE.Vector3(tur.x, 0, tur.z), 0xc9b48b);
    }
    v.pop = Math.min(1, (v.pop || 0) + dt * 4);
    v.group.scale.setScalar(0.01 + v.pop * 0.99);
    v.rot.rotation.y += angleDiff(tur.angle || 0, v.rot.rotation.y) * Math.min(1, dt * 8);
    v.core.scale.setScalar(1 + Math.sin(t * 3.4 + tur.id) * 0.1);
    v.coreGlow.material.opacity = 0.4 + Math.sin(t * 3.4 + tur.id) * 0.12;
  }
  for (const [id, v] of turretViews) {
    if (seen.has(id)) continue;
    effects.dust(v.group.position.clone(), 0x8b8170);
    effects.ring(v.group.position.clone(), 0xff9a46, 2.4, 0.4);
    disposeGroup(v.group);
    turretViews.delete(id);
  }
}

function syncCrates(dt, t) {
  const seen = new Set();
  for (const crate of env.crates) {
    seen.add(crate.id);
    let v = crateViews.get(crate.id);
    if (!v) {
      const mesh = createCrateMesh();
      mesh.group.position.set(crate.x, 0, crate.z);
      scene.add(mesh.group);
      v = { ...mesh, pop: 0 };
      crateViews.set(crate.id, v);
    }
    v.pop = Math.min(1, (v.pop || 0) + dt * 5);
    v.group.scale.setScalar(0.2 + v.pop * 0.8);
    v.group.rotation.y = Math.sin(t * 0.7 + crate.id) * 0.18;
    v.group.position.y = Math.sin(t * 2 + crate.id) * 0.05;
    v.scrap.rotation.y += dt * 1.4;
    v.glow.material.opacity = 0.5 + Math.sin(t * 2.8 + crate.id) * 0.15;
  }
  for (const [id, v] of crateViews) {
    if (seen.has(id)) continue;
    effects.flash(v.group.position.clone().setY(0.8));
    effects.dust(v.group.position.clone(), 0xd8b46a);
    disposeGroup(v.group);
    crateViews.delete(id);
  }
}

function syncPickups(dt, t) {
  const seen = new Set();
  for (const p of env.pickups) {
    seen.add(p.id);
    let v = pickupViews.get(p.id);
    if (!v) {
      const mesh = createPickupMesh(p.kind);
      mesh.group.position.set(p.x, 0, p.z);
      mesh.group.rotation.y = (p.id % 7) * 0.9;
      scene.add(mesh.group);
      v = { ...mesh, pop: 0, kind: p.kind };
      pickupViews.set(p.id, v);
    }
    v.pop = Math.min(1, (v.pop || 0) + dt * 4);
    const ease = 1 - Math.pow(1 - v.pop, 3);
    v.group.scale.setScalar(0.25 + ease * 0.75);
    if (v.float) {
      v.float.position.y = v.floatBase + Math.sin(t * 2.2 + p.id) * 0.08;
      v.float.rotation.y += dt * 1.1;
    }
    if (v.glow) v.glow.material.opacity = 0.42 + Math.sin(t * 3.1 + p.id) * 0.16;
    if (v.ring) v.ring.rotation.z += dt * 0.5;
  }
  for (const [id, v] of pickupViews) {
    if (seen.has(id)) continue;
    effects.flash(v.group.position.clone().setY(0.7));
    disposeGroup(v.group);
    pickupViews.delete(id);
  }
}

function syncFires(dt, t) {
  const seen = new Set();
  for (const f of env.fires) {
    seen.add(f.id);
    let v = fireViews.get(f.id);
    if (!v) {
      v = createFireZone(f.r);
      v.group.position.set(f.x, 0, f.z);
      scene.add(v.group);
      fireViews.set(f.id, v);
    }
    const fade = Math.min(1, f.t / 1.2);
    v.disc.material.opacity = 0.12 + Math.sin(t * 6 + f.id) * 0.03;
    v.ring.material.opacity = 0.38 * fade;
    v.group.scale.setScalar(0.85 + Math.sin(t * 3 + f.id) * 0.04);
    v.light.intensity = (16 + Math.sin(t * 9 + f.id) * 5) * fade;
    for (let i = 0; i < v.flames.length; i++) {
      const fl = v.flames[i];
      const s = 0.65 + Math.sin(t * 7 + fl.phase + i) * 0.25;
      fl.sprite.position.set(
        fl.baseX + Math.sin(t * 2.7 + fl.phase) * 0.18,
        0.28 + (Math.sin(t * 5.2 + fl.phase * 2) * 0.5 + 0.5) * 0.75,
        fl.baseZ + Math.cos(t * 3.1 + fl.phase) * 0.18
      );
      fl.sprite.scale.setScalar(fl.baseScale * (0.7 + s * 0.6) * (0.7 + fade * 0.3));
      fl.sprite.material.opacity = (0.55 + Math.sin(t * 8 + fl.phase) * 0.18) * fade;
    }
  }
  for (const [id, v] of fireViews) {
    if (seen.has(id)) continue;
    effects.dust(v.group.position.clone(), 0x3b352d);
    disposeGroup(v.group);
    fireViews.delete(id);
  }
}

/* ------------------------------------------------------------------ */
/*  Simulation events                                                 */
/* ------------------------------------------------------------------ */
function handleEvents(events) {
  const muzzle = survivor.getMuzzleWorld(new THREE.Vector3());
  for (const ev of events) {
    switch (ev.type) {
      case 'shot': {
        if (ev.kind === 'pistol' || ev.kind === 'shotgun' || ev.kind === 'rifle') {
          survivorFireT = 0.16;
          const wide = ev.kind === 'shotgun';
          const muzzleColor = wide ? 0xffb15e : ev.kind === 'rifle' ? 0xa8d8e8 : 0xffd391;
          effects.muzzle(muzzle, muzzleColor);
          const to = new THREE.Vector3(ev.tx, 1.0, ev.tz);
          effects.tracer(muzzle, to, {
            color: wide ? 0xffad55 : ev.kind === 'rifle' ? 0xbfe6f2 : 0xffd489,
            life: wide ? 0.14 : 0.09,
            impact: ev.hit,
            sparks: wide ? 8 : ev.kind === 'rifle' ? 5 : 4,
          });
          if (ev.hit) audio.hit();
          if (wide) audio.shotgun();
          else if (ev.kind === 'rifle') audio.rifle();
          else audio.pistol();
        }
        break;
      }
      case 'turretShot': {
        const v = turretViews.get(ev.id);
        const from = new THREE.Vector3(ev.x, 1.5, ev.z);
        if (v) v.muzzle.getWorldPosition(from);
        const to = new THREE.Vector3(ev.tx, 0.9, ev.tz);
        effects.tracer(from, to, { color: 0xa8cfa0, life: 0.09, impact: true, sparks: 2 });
        effects.muzzle(from, 0xcfe6a2);
        audio.turret();
        break;
      }
      case 'kill': {
        const pos = new THREE.Vector3(ev.x, 0, ev.z);
        effects.blood(pos, ev.type === 'brute' ? 22 : 12);
        if (ev.type === 'brute') {
          effects.ring(pos, 0x8f2a24, 2.6, 0.5);
          spawnShake(0.25, 0.25);
        }
        audio.kill();
        break;
      }
      case 'hit':
        break;
      case 'spawn': {
        effects.dust(new THREE.Vector3(ev.x, 0, ev.z), 0x6b6754);
        break;
      }
      case 'build': {
        effects.ring(new THREE.Vector3(ev.x, 0, ev.z), 0xd8ab63, 2.2, 0.5);
        audio.build();
        toast('TURRET DEPLOYED  ·  −25 SCRAP');
        break;
      }
      case 'molotov': {
        const from = new THREE.Vector3(ev.x, 1.3, ev.z);
        const to = new THREE.Vector3(ev.tx, 0.2, ev.tz);
        effects.throwProjectile(from, to, (land) => {
          effects.explosion(land);
          audio.explosion();
          spawnShake(0.4, 0.35);
        });
        break;
      }
      case 'crate': {
        effects.flash(new THREE.Vector3(ev.x, 0.8, ev.z));
        effects.ring(new THREE.Vector3(ev.x, 0, ev.z), 0xffc35e, 2, 0.45);
        audio.crate();
        toast(`+${Math.round(ev.amount ?? 12)} SCRAP`);
        break;
      }
      case 'pickupSpawn': {
        effects.ring(new THREE.Vector3(ev.x, 0, ev.z), 0xcfd8b0, 1.6, 0.5);
        break;
      }
      case 'pickup': {
        const pos = new THREE.Vector3(ev.x, 0.6, ev.z);
        effects.flash(pos);
        effects.ring(new THREE.Vector3(ev.x, 0, ev.z), 0xdfe8c0, 2.2, 0.45);
        spawnShake(0.08, 0.15);
        if (ev.kind === 'perk') {
          audio.perk();
          flashScreen(0.35);
          toast(ev.label || 'PERK CLAIMED', 3000);
        } else if (ev.kind === 'weapon') {
          audio.perk();
          toast(ev.label || 'WEAPON ACQUIRED', 3000);
        } else if (ev.kind === 'medkit') {
          audio.medkit();
          toast(ev.label || '+1 MEDKIT');
        } else if (ev.kind === 'bomb') {
          audio.medkit();
          toast(ev.label || '+1 FIREBOMB');
        } else {
          audio.pickup();
          toast(ev.label || '+AMMO');
        }
        break;
      }
      case 'medkit': {
        const pos = new THREE.Vector3(ev.x, 0.8, ev.z);
        effects.ring(pos, 0xe4705f, 2.4, 0.5);
        effects.flash(pos);
        audio.medkit();
        toast(`MEDKIT · +${Math.round(ev.healed)} VITALITY`);
        break;
      }
      case 'reload': {
        audio.reload();
        break;
      }
      case 'reloadDone': {
        audio.pickup();
        break;
      }
      case 'dry': {
        audio.dry();
        toast('MAGAZINE EMPTY');
        break;
      }
      case 'swap': {
        audio.swap();
        break;
      }
      case 'houseHit': {
        effects.dust(new THREE.Vector3(ev.x, 1.2, ev.z), 0xa49882);
        effects.spawnParticle({
          pos: new THREE.Vector3(ev.x, 1.2, ev.z),
          vel: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5),
          life: 0.4, size: 0.35, endSize: 0, color: 0xff9a44, gravity: -6,
        });
        flashScreen(0.4);
        spawnShake(0.22, 0.22);
        audio.hurt();
        break;
      }
      case 'hurtAgent':
        flashScreen(0.8);
        spawnShake(0.35, 0.3);
        audio.hurt();
        break;
      case 'turretHit': {
        effects.spawnParticle({
          pos: new THREE.Vector3(ev.x, 1.4, ev.z),
          vel: new THREE.Vector3(0, 2, 0),
          life: 0.35, size: 0.4, endSize: 0, color: 0xffb45c, gravity: -4,
        });
        break;
      }
      case 'wave':
        banner('THE HORDE WALKS IN', `WAVE ${String(ev.wave).padStart(2, '0')} · ${ev.quota ?? '?'} SOULS`);
        audio.wave();
        break;
      case 'waveClear':
        effects.ring(new THREE.Vector3(0, 0.35, CFG.houseZ), 0xb6cf8e, 7, 0.9);
        audio.hold();
        visibleWavesHeld = Math.max(visibleWavesHeld, env.wavesCleared);
        toast(`WAVE ${String(ev.wave).padStart(2, '0')} HELD · ${ev.kills} SOULS`);
        drawRewardChart();
        saveCheckpoint(false);
        break;
      case 'dash':
        effects.ring(new THREE.Vector3(ev.x, 0, ev.z), 0xcdbb90, 2.4, 0.4);
        effects.dust(new THREE.Vector3(ev.x, 0, ev.z), 0xb0a589);
        audio.dash();
        break;
      case 'fire': {
        effects.spawnParticle({
          pos: new THREE.Vector3(ev.x, 0.2, ev.z),
          vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.8 + Math.random() * 2, (Math.random() - 0.5) * 0.8),
          life: 0.35 + Math.random() * 0.3,
          size: 0.3 + Math.random() * 0.45,
          endSize: 0.02,
          color: Math.random() > 0.4 ? 0xffab4a : 0xffdf8f,
          gravity: 1.5,
        });
        break;
      }
      case 'end':
        break;
      default:
        break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Policy / training                                                 */
/* ------------------------------------------------------------------ */
function encodeWeights(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(bin);
}

function decodeWeights(b64) {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  } catch {
    return null;
  }
}

function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.weights) return;
    const w = decodeWeights(data.weights);
    if (w && policy.setWeights(w)) {
      policyReady = true;
      savedIteration = data.iteration || 0;
      metrics = data.metrics || null;
      baseline = data.baseline || null;
      evaluation = data.evaluation || null;
      evaluationHistory = Array.isArray(data.evaluationHistory) ? data.evaluationHistory.slice(-100) : [];
      rewardHistory = Array.isArray(data.history) ? data.history.slice(-160) : [];
      waveHistory = Array.isArray(data.waves) ? data.waves.slice(-160) : [];
      coreWaves = data.coreWaves || 0;
      coreBestWave = data.coreBestWave || 0;
      visibleWavesHeld = data.visibleWavesHeld || 0;
      noteText = `Restored core iteration ${savedIteration}.`;
    }
  } catch (err) {
    console.warn('Checkpoint load failed', err);
  }
}

function recordEvaluation() {
  if (!evaluation || !Number.isFinite(evaluation.kills)) return;
  if (evaluationHistory.at(-1)?.iteration !== evaluation.iteration) {
    evaluationHistory.push({ iteration: evaluation.iteration, kills: evaluation.kills, waves: evaluation.waves });
    evaluationHistory = evaluationHistory.slice(-100);
  }
}

function saveCheckpoint(force = false) {
  if (!policyReady) return;
  const now = performance.now();
  if (!force && now - saveTimer < 18000) return;
  saveTimer = now;
  try {
    const data = {
      weights: encodeWeights(policy.getWeights()),
      baseline, evaluation, evaluationHistory,
      iteration: savedIteration,
      metrics: metrics ? { ...metrics, recent: undefined, recentWaves: undefined } : null,
      history: rewardHistory.slice(-160),
      waves: waveHistory.slice(-160),
      coreWaves,
      coreBestWave,
      visibleWavesHeld,
      savedAt: Date.now(),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Checkpoint save failed', err);
  }
}

function ensureWorker() {
  if (worker) return;
  try {
    worker = new Worker(new URL('./sim/worker.js', import.meta.url), { type: 'module' });
  } catch (err) {
    noteText = 'Worker failed to start: ' + err.message;
    updateCoreUI();
    return;
  }
  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ready':
        // Adopt the worker's freshly initialised policy unless a saved core exists.
        if (!policyReady && msg.weights && msg.weights.length === policy.weightCount()) {
          policy.setWeights(msg.weights);
          policyReady = true;
        }
        break;
      case 'status':
        training = !!msg.training;
        if (typeof msg.iteration === 'number') savedIteration = Math.max(savedIteration, msg.iteration);
        if (msg.totalSteps) metrics = { ...(metrics || {}), totalSteps: msg.totalSteps, iteration: savedIteration };
        if (msg.message) noteText = msg.message;
        if (!training) saveCheckpoint(true);
        updateCoreUI();
        break;
      case 'evaluation':
        baseline = msg.baseline;
        evaluation = msg.evaluation;
        recordEvaluation();
        updateCoreUI();
        drawRewardChart();
        break;
      case 'metrics': {
        baseline = msg.baseline || baseline;
        evaluation = msg.evaluation || evaluation;
        recordEvaluation();
        metrics = msg;
        policyReady = true;
        savedIteration = msg.iteration || savedIteration;
        if (typeof msg.meanReward === 'number') {
          rewardHistory.push(msg.meanReward);
          if (rewardHistory.length > 160) rewardHistory.shift();
        }
        if (typeof msg.meanRunWaves === 'number') {
          waveHistory.push(msg.meanRunWaves);
          if (waveHistory.length > 160) waveHistory.shift();
        }
        coreWaves = Math.max(coreWaves, msg.wavesCleared || 0);
        coreBestWave = Math.max(coreBestWave, msg.bestWave || 0);
        noteText = `Iter ${msg.iteration} · holds ${fmt(msg.meanRunWaves, 1)} waves per episode · KL ${fmt(msg.kl, 3)}`;
        updateCoreUI();
        drawRewardChart();
        saveCheckpoint(false);
        break;
      }
      case 'weights': {
        if (msg.iteration >= 0 && msg.data) {
          if (msg.data.length === policy.weightCount()) {
            policy.setWeights(msg.data);
            policyReady = true;
            savedIteration = Math.max(savedIteration, msg.iteration);
            saveCheckpoint(false);
            updateCoreUI();
          }
        }
        break;
      }
      default:
        break;
    }
  };
  worker.onerror = (err) => {
    noteText = 'Worker error: ' + (err.message || 'unknown');
    training = false;
    updateCoreUI();
    console.error(err);
  };
}

function startTraining() {
  if (training) return;
  ensureWorker();
  if (!worker) return;
  if (!workerStarted) {
    const weights = policyReady ? policy.getWeights() : null;
    worker.postMessage({
      type: 'start',
      weights,
      iterations: savedIteration,
      wavesCleared: coreWaves,
      wavesAttempted: metrics?.wavesAttempted || coreWaves,
      totalSteps: metrics?.totalSteps || 0,
      bestWave: coreBestWave,
      baseline, evaluation,
    });
    workerStarted = true;
    noteText = 'Boot sequence · mapping the grove…';
  } else {
    worker.postMessage({ type: 'resume' });
    noteText = 'Re-engaging PPO optimisation…';
  }
  training = true;
  audio.ui();
  updateCoreUI();
  toast('PPO CORE TRAINING');
}

function pauseTraining() {
  if (!worker) return;
  worker.postMessage({ type: 'pause' });
  training = false;
  saveCheckpoint(true);
  audio.ui();
  updateCoreUI();
  toast('TRAINING PAUSED');
}

function wipeCore() {
  const ok = window.confirm('Erase the trained policy and start from an untrained core?');
  if (!ok) return;
  if (worker) { worker.terminate(); worker = null; }
  workerStarted = false;
  training = false;
  policy = new PPOAgent();
  policyReady = false;
  metrics = null;
  rewardHistory = [];
  waveHistory = [];
  baseline = null; evaluation = null; evaluationHistory = [];
  coreWaves = 0;
  coreBestWave = 0;
  visibleWavesHeld = 0;
  savedIteration = 0;
  localStorage.removeItem(STORE_KEY);
  noteText = 'Core wiped. Learning restarts from an untrained policy.';
  updateCoreUI();
  drawRewardChart();
  toast('COGNITION CORE WIPED');
  setTimeout(() => { if (!training) startTraining(); }, 600);
}

/* ------------------------------------------------------------------ */
/*  UI                                                                */
/* ------------------------------------------------------------------ */
function fmt(v, digits = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}
function formatNumber(v) {
  if (v == null) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'm';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return Math.round(v).toString();
}

function updateCoreUI() {
  const status = $('ai-status');
  const sub = $('ai-sub');
  const dot = $('ai-live');
  const trainBtn = $('btn-train');
  const pauseBtn = $('btn-pause');

  let state = 'PPO CORE';
  let stateClass = 'ready';
  let subText = 'policy online · learning from scratch';

  if (training) {
    state = 'TRAINING';
    stateClass = 'training';
    subText = `iter ${savedIteration} · ${metrics ? formatNumber(metrics.totalSteps) : 'boot'}`;
  } else if (workerStarted && metrics) {
    state = 'PAUSED';
    stateClass = 'ready';
    subText = `iter ${savedIteration} · policy retained`;
  } else if (policyReady) {
    state = 'PPO READY';
    stateClass = 'ready';
    subText = `policy active · iter ${savedIteration}`;
  }

  status.textContent = state;
  status.className = 'status-plate ' + stateClass;
  sub.textContent = subText;
  dot.classList.toggle('on', training);
  trainBtn.disabled = training;
  pauseBtn.disabled = !training;
  $('train-note').firstChild.textContent = noteText + ' ';
  $('btn-train').querySelector('span:last-child').textContent = training
    ? 'Training…'
    : workerStarted ? 'Resume Core' : 'Train Core';

  // metrics — progress is measured in the waves a defence sustains
  const m = metrics;
  const bestWaveOverall = Math.max(coreBestWave, visibleWavesHeld, m?.bestWave || 0);
  $('m-waves').textContent = formatNumber(coreWaves);
  $('m-best-wave').textContent = String(bestWaveOverall);
  $('m-run-waves').textContent = m && m.meanRunWaves != null ? fmt(m.meanRunWaves, 1) : '—';
  $('m-hold-rate').textContent = m && m.clearRate != null ? Math.round(m.clearRate * 100) + '%' : '—';
  $('m-steps').textContent = m && m.totalSteps != null ? formatNumber(m.totalSteps) : '0';
  $('m-reward').textContent = m && m.meanReward != null ? fmt(m.meanReward, 2) : '—';
  $('m-kills').textContent = m && m.meanKills != null ? fmt(m.meanKills, 1) : '—';
  $('m-ploss').textContent = m && m.policyLoss != null ? fmt(m.policyLoss, 3) : '—';
  $('m-vloss').textContent = m && m.valueLoss != null ? fmt(m.valueLoss, 3) : '—';
  $('m-entropy').textContent = m && m.entropy != null ? fmt(m.entropy, 2) : '—';
  $('m-observation').textContent = String(OBS_SIZE);
  $('m-actions').textContent = `${ACTION_HEADS.reduce((count, head) => count * head.size, 1)} before masks`;
  $('m-curve-label').textContent = evaluation ? `update ${evaluation.iteration}` : 'awaiting test';
  $('eval-baseline').textContent = baseline ? fmt(baseline.kills, 1) : '—';
  $('eval-current').textContent = evaluation ? fmt(evaluation.kills, 1) : '—';
  const change = evaluation && baseline ? evaluation.kills - baseline.kills : 0;
  $('learning-trend').textContent = !baseline ? 'Measuring baseline'
    : !evaluation?.iteration ? 'Exploring' : `${change >= 0 ? '+' : ''}${fmt(change, 1)} kills`;
  $('learning-trend').dataset.trend = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  $('eval-note').textContent = evaluation
    ? `${fmt(evaluation.waves, 2)} waves held · ${fmt(evaluation.seconds, 0)}s survived · tested every 10 updates`
    : 'Comparing the farmer against the same four unseen hordes.';
}

function drawRewardChart() {
  if (!rewardCanvas) return;
  const ctx = rewardCanvas.getContext('2d');
  const W = rewardCanvas.width, H = rewardCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(231,221,200,.06)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (H / 4) * i);
    ctx.lineTo(W, (H / 4) * i);
    ctx.stroke();
  }
  const data = evaluationHistory.map(e => e.kills);
  if (!data.length) {
    ctx.fillStyle = 'rgba(169,164,145,.32)';
    ctx.font = '13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('First field test after update 10', W / 2, H / 2 + 4);
    return;
  }
  let min = 0, max = Math.max(4, ...data, baseline?.kills || 0);
  if (max - min < 4) { const mid = (max + min) / 2; min = mid - 2; max = mid + 2; }
  const pad = (max - min) * 0.18;
  min -= pad; max += pad;
  const px = (i) => (i / Math.max(1, data.length - 1)) * (W - 6) + 3;
  const py = (v) => H - 8 - ((v - min) / (max - min)) * (H - 16);

  if (baseline) {
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#8e9a8b';
    ctx.beginPath(); ctx.moveTo(0, py(baseline.kills)); ctx.lineTo(W, py(baseline.kills)); ctx.stroke();
    ctx.setLineDash([]);
  }
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(216,171,99,.28)');
  grad.addColorStop(1, 'rgba(216,171,99,0)');
  ctx.beginPath();
  ctx.moveTo(px(0), H);
  for (let i = 0; i < data.length; i++) ctx.lineTo(px(i), py(data[i]));
  ctx.lineTo(px(data.length - 1), H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    if (i === 0) ctx.moveTo(px(i), py(data[i]));
    else ctx.lineTo(px(i), py(data[i]));
  }
  ctx.strokeStyle = '#d8ab63';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(216,171,99,.5)';
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;
  const lastX = px(data.length - 1), lastY = py(data[data.length - 1]);
  ctx.fillStyle = '#f1cc89';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function updateHUD(dt) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.09;
  $('hud-wave').textContent = String(env.wave).padStart(2, '0');
  $('hud-held').textContent = String(env.wavesCleared);
  $('hud-scrap').textContent = Math.floor(env.agent.scrap);
  $('hud-souls').textContent = `${env.waveKills}/${env.waveQuota}`;
  const hpPct = Math.max(0, env.houseHp / CFG.houseMaxHp) * 100;
  const fill = $('hud-house-hp');
  fill.style.width = hpPct.toFixed(1) + '%';
  fill.style.background = hpPct < 35
    ? 'linear-gradient(90deg,#8f3028,#c6644f)'
    : hpPct < 65
      ? 'linear-gradient(90deg,#9a7a4a,#d8b46a)'
      : 'linear-gradient(90deg,#7f9d6d,#b6cf8e)';
  const gear = env.gearInfo();
  $('agent-hp').style.width = Math.max(0, (env.agent.hp / env.agent.maxHp) * 100).toFixed(1) + '%';
  $('agent-mode').textContent = mode === 'play'
    ? 'MANUAL OVERRIDE'
    : training ? 'PPO · LEARNING' : 'PPO · POLICY ACTIVE';
  $('agent-weapon').textContent = gear.reloading
    ? `${gear.name.toUpperCase()} · RELOADING`
    : gear.mag === Infinity
      ? `${gear.name.toUpperCase()} · ∞`
      : `${gear.name.toUpperCase()} · ${gear.mag}/${gear.reserve}`;
  $('hud-ammo').textContent = gear.mag === Infinity ? '∞' : String(gear.mag);
  $('hud-gear').textContent = `${gear.bombs} bomb${gear.bombs === 1 ? '' : 's'} · ${gear.medkits} kit${gear.medkits === 1 ? '' : 's'}`;
  const heldPerks = PERKS.filter((p) => env.agent.perks[p]);
  const perkRow = $('agent-perks');
  if (heldPerks.length !== perkRow.childElementCount || perkRow.dataset.perks !== heldPerks.join(',')) {
    perkRow.dataset.perks = heldPerks.join(',');
    perkRow.innerHTML = heldPerks.length
      ? heldPerks.map((p) => `<span class="perk-tag">${PERK_NAMES[p]}</span>`).join('')
      : '<span class="perk-tag dim">no perks yet</span>';
  }
  const labels = ['idle', 'fire', 'cycle', 'deploy turret', 'firebomb', 'evade', 'medkit', 'reload'];
  const movelabels = ['idle', 'north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  $('agent-action').textContent = lastAction.action
    ? [lastAction.action.fire ? 'fire' : '', lastAction.action.utility ? UTILITY_NAMES[lastAction.action.utility] : '', lastAction.move ? movelabels[lastAction.move] : ''].filter(Boolean).join(' + ') || 'wait'
    : lastAction.combat === 0
    ? (lastAction.move ? movelabels[lastAction.move] : 'idle')
    : labels[lastAction.combat];

  // hit flash decay
  screenFlash = Math.max(0, screenFlash - dt * 2.4);
  hitFlash.style.opacity = screenFlash.toFixed(3);
}

function showResult() {
  resultShown = true;
  const dead = env.outcome === 'dead';
  const held = env.wavesCleared;
  const word = held === 1 ? 'wave' : 'waves';
  $('result-kicker').textContent = 'SIMULATION TERMINATED';
  $('result-title').textContent = dead ? 'MARA HAS FALLEN' : 'THE HOUSE HAS FALLEN';
  $('result-sub').textContent = dead
    ? `Held ${held} ${word} · Mara fell on wave ${env.wave}. The core remembers.`
    : `Held ${held} ${word} · the house broke on wave ${env.wave}. Its lights go out.`;
  $('result-wave').textContent = String(held).padStart(2, '0');
  $('result-kills').textContent = env.episodeKills;
  $('result-time').textContent = `${Math.round(env.time)}s`;
  $('result-scrap').textContent = Math.floor(env.scrapCollected);
  visibleWavesHeld = Math.max(visibleWavesHeld, held);
  saveCheckpoint(false);
  resultScreen.hidden = false;
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => {
    if (!resultScreen.hidden) resetRun();
  }, 9000);
}

/* The safety cap cut a defence that never broke. That is not a failure: credit
   the waves it held and start a fresh episode from wave 1. */
function restartEpisode() {
  visibleWavesHeld = Math.max(visibleWavesHeld, env.wavesCleared);
  banner('THE GROVE HOLDS', `DEFENCE CUT AT WAVE ${String(env.wave).padStart(2, '0')} · ${env.wavesCleared} WAVES HELD`);
  toast('EPISODE TRUNCATED · RESTARTING');
  resetRun();
  drawRewardChart();
  saveCheckpoint(false);
}

function resetRun() {
  // The env owns episode state (waves held, kills, scrap, time), so a reset
  // simply starts a fresh defence from wave 1 with base gear.
  const seed = ((Date.now() ^ (Math.random() * 1e9)) >>> 0);
  env.reset(seed);
  env.clearEvents();
  clearVisuals();
  survivor.reset();
  survivor.group.visible = true;
  survivor.group.position.set(env.agent.x, 0, env.agent.z);
  prevAgent.set(env.agent.x, 0, env.agent.z);
  lastAction = { move: 0, combat: 0 };
  decisionTimer = 0;
  survivorFireT = 0;
  resultShown = false;
  resultScreen.hidden = true;
  clearTimeout(resultTimer);
  screenFlash = 0;
  hitFlash.style.opacity = '0';
  manualAim = 0;
  toast('EPISODE RESET · WAVE 01 INCOMING');
  banner('HOLLOW GROVE', 'WAVE 01 · DEFEND THE HOUSE');
  updateHUD(1);
  saveCheckpoint(false);
}

/* ------------------------------------------------------------------ */
/*  Modes & controls                                                  */
/* ------------------------------------------------------------------ */
const modeHints = {
  watch: '<span class="hint-key">1</span> watch &nbsp; <span class="hint-key">2</span> take control &nbsp; <span class="hint-key">3</span> spectate &nbsp; <span class="hint-key">T</span> train core &nbsp; <span class="hint-key">R</span> reset defence',
  play: '<span class="hint-key">WASD</span> move &nbsp; <span class="hint-key">MOUSE</span> aim &nbsp; <span class="hint-key">LMB</span> fire &nbsp; <span class="hint-key">RMB</span> cycle weapon &nbsp; <span class="hint-key">Z</span> reload &nbsp; <span class="hint-key">E</span> turret &nbsp; <span class="hint-key">Q</span> firebomb &nbsp; <span class="hint-key">V</span> medkit &nbsp; <span class="hint-key">SPACE</span> dash',
  observe: '<span class="hint-key">SPECTATING</span> the guild watches in silence &nbsp; <span class="hint-key">1</span>/<span class="hint-key">2</span> to return',
};

function setMode(next) {
  if (next === mode) return;
  mode = next;
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === mode);
  });
  hud.classList.toggle('cinematic', mode === 'observe');
  reticle.visible = mode === 'play';
  if (mode === 'play' && env.done) resetRun();
  $('hint').innerHTML = modeHints[mode] || modeHints.watch;
  const kicker = mode === 'play' ? 'OPERATIVE LINK' : mode === 'observe' ? 'OBSERVATION' : 'NEURAL UPLINK';
  const text = mode === 'play' ? 'TAKE CONTROL' : mode === 'observe' ? 'SPECTATE THE GROVE' : 'AUTONOMOUS DEFENSE';
  if (!resultShown) banner(kicker, text);
  audio.ui();
}

function wireUI() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
  $('btn-train').addEventListener('click', startTraining);
  $('btn-pause').addEventListener('click', pauseTraining);
  $('btn-learning').addEventListener('click', () => {
    const expanded = hud.classList.toggle('show-learning');
    $('btn-learning').setAttribute('aria-expanded', String(expanded));
  });
  $('btn-reset-core').addEventListener('click', wipeCore);
  $('btn-again').addEventListener('click', resetRun);
  $('btn-sound').addEventListener('click', () => audio.toggle());
  $('btn-follow').addEventListener('click', () => {
    followFarmer = !followFarmer;
    $('btn-follow').setAttribute('aria-pressed', String(followFarmer));
    $('btn-follow').textContent = followFarmer ? 'VIEW WHOLE FARM' : 'FOLLOW FARMER';
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    switch (e.code) {
      case 'Digit1': setMode('watch'); break;
      case 'Digit2': setMode('play'); break;
      case 'Digit3': setMode('observe'); break;
      case 'KeyT':
        if (!training) startTraining();
        break;
      case 'KeyR':
        resetRun();
        break;
      case 'Escape':
        if (mode !== 'watch') setMode('watch');
        break;
      default: break;
    }
    if (mode === 'play') {
      keys.add(e.code);
      if (['Space', 'KeyE', 'KeyQ', 'KeyF', 'KeyX', 'KeyV', 'KeyZ', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.ndcX = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) mouse.right = true;
    if (mode !== 'play') return;
    audio.ensure();
    canvas.setPointerCapture?.(e.pointerId);
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0 || e.pointerType === 'touch') mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('resize', onResize);

  window.addEventListener('beforeunload', () => saveCheckpoint(true));
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ------------------------------------------------------------------ */
/*  Frame update                                                      */
/* ------------------------------------------------------------------ */
function currentControl(dt = 1 / 60) {
  if (mode === 'play' && !env.done) {
    const mx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const mz = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    return {
      mx, mz,
      aim: manualAim,
      fire: mouse.left || keys.has('KeyF'),
      cycle: mouse.right || keys.has('KeyX'),
      buildTurret: keys.has('KeyE'),
      throwMolotov: keys.has('KeyQ'),
      dash: keys.has('Space'),
      medkit: keys.has('KeyV'),
      reload: keys.has('KeyZ'),
    };
  }

  // autonomous — the field agent is always driven by the PPO policy
  decisionTimer -= dt;
  if (decisionTimer <= 0) {
    decisionTimer = 0.2;
    const obs = env.getObservation();
    const act = policy.act(obs, false);
    const choice = [act.action.fire ? 'Fire' : 'Hold fire', act.action.utility ? UTILITY_NAMES[act.action.utility] : null].filter(Boolean).join(' + ');
    $('policy-choice').textContent = choice;
    const probability = policy.heads.find(h => h.name === 'fire').p[1];
    $('policy-confidence').style.transform = `scaleX(${probability})`;
    $('policy-note').textContent = `${Math.round(probability * 100)}% fire probability · policy update ${savedIteration}`;
    lastAction = { move: act.move, combat: act.combat, action: act.action };
  }
  if (lastAction.action) return tacticalControl(lastAction.action);
  const dir = MOVE_DIRS[lastAction.move] || [0, 0];
  return {
    mx: dir[0],
    mz: dir[1],
    aim: null,
    fire: lastAction.combat === COMBAT.FIRE,
    cycle: lastAction.combat === COMBAT.CYCLE,
    buildTurret: lastAction.combat === COMBAT.TURRET,
    throwMolotov: lastAction.combat === COMBAT.MOLOTOV,
    dash: lastAction.combat === COMBAT.DASH,
    medkit: lastAction.combat === COMBAT.MEDKIT,
    reload: lastAction.combat === COMBAT.RELOAD,
  };
}

function updateCamera(dt) {
  if (debugCam) {
    camera.position.set(debugCam.x || 0, debugCam.y, debugCam.z);
    camera.fov = debugCam.fov || 52;
    camera.updateProjectionMatrix();
    camera.lookAt(debugCam.tx ?? 0, debugCam.ty ?? 0, debugCam.tz ?? -7);
    return;
  }
  introT = Math.min(1, introT + dt / 2.4);
  const ease = 1 - Math.pow(1 - introT, 3);
  const aspect = window.innerWidth / window.innerHeight;
  const zoom = Math.max(1, 1.42 / aspect);
  const baseY = mode === 'play' ? 42 : mode === 'observe' ? 47 : 46;
  const baseZ = mode === 'play' ? 25 : mode === 'observe' ? 31 : 28;
  const driftX = mode === 'observe' ? Math.sin(elapsed * 0.08) * 1.8 : 0;
  const targetPos = new THREE.Vector3(
    driftX,
    baseY * zoom,
    baseZ * zoom
  );
  if (followFarmer) targetPos.set(env.agent.x, 25 * zoom, env.agent.z + 18 * zoom);
  const startPos = new THREE.Vector3(0, 68, 44);
  const desired = startPos.clone().lerp(targetPos, ease);
  camera.position.lerp(desired, Math.min(1, dt * 3));

  const look = CAM_TARGET.clone();
  if (followFarmer) look.set(env.agent.x, 0, env.agent.z);
  if (mode !== 'play') {
    look.x += mouse.ndcX * 0.7;
    look.z += mouse.ndcY * 0.45;
  }
  camera.lookAt(look);

  if (shakeT > 0) {
    shakeT -= dt;
    const s = shakeMag * Math.min(1, shakeT / 0.2);
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
    if (shakeT <= 0) shakeMag = 0;
  }
}

function updateSurvivor(dt) {
  const a = env.agent;
  const dx = a.x - prevAgent.x;
  const dz = a.z - prevAgent.z;
  const speed = Math.min(8, Math.hypot(dx, dz) / Math.max(dt, 0.001));
  survivor.group.position.set(a.x, 0, a.z);
  survivor.update(dt, elapsed, {
    speed,
    aim: a.aim,
    firing: survivorFireT > 0,
    dead: env.done && env.outcome === 'dead',
  });
  survivorFireT = Math.max(0, survivorFireT - dt);
  prevAgent.set(a.x, 0, a.z);
}

function updateReticle() {
  if (mode !== 'play') { reticle.visible = false; return; }
  reticle.visible = true;
  raycaster.setFromCamera(new THREE.Vector2(mouse.ndcX, mouse.ndcY), camera);
  const hit = raycaster.ray.intersectPlane(groundPlane, manualAimPoint);
  if (hit) {
    manualAim = Math.atan2(manualAimPoint.x - env.agent.x, manualAimPoint.z - env.agent.z);
    reticle.position.set(manualAimPoint.x, 0.06, manualAimPoint.z);
  }
  const dist = Math.hypot(manualAimPoint.x - env.agent.x, manualAimPoint.z - env.agent.z);
  reticle.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.05);
}

function animate(now) {
  requestAnimationFrame(animate);
  const dtRaw = Math.min(0.05, (now - lastTick) / 1000 || 0.016);
  lastTick = now;
  elapsed += dtRaw;

  if (mode === 'play') updateReticle();

  if (!resultShown && !env.done) {
    const control = currentControl(dtRaw);
    env.advance(dtRaw, control);
  } else if (env.done && !resultShown) {
    // An episode ends only when Mara or the house falls; the safety cap is a
    // truncation, not a defeat, so it quietly starts the next defence.
    if (env.truncated) restartEpisode();
    else showResult();
  }

  handleEvents(env.clearEvents());
  syncZombies(dtRaw, elapsed);
  syncTurrets(dtRaw, elapsed);
  syncCrates(dtRaw, elapsed);
  syncPickups(dtRaw, elapsed);
  syncFires(dtRaw, elapsed);
  updateSurvivor(dtRaw);
  updateCamera(dtRaw);
  world.update(dtRaw, elapsed);
  effects.update(dtRaw);
  updateHUD(dtRaw);

  if (training) saveCheckpoint(false);
  renderer.render(scene, camera);
}

/* ------------------------------------------------------------------ */
/*  Boot                                                              */
/* ------------------------------------------------------------------ */
window.__grove = {
  camera, scene, renderer, world, survivor, effects,
  get env() { return env; },
  get metrics() { return metrics; },
  get run() {
    return {
      wavesHeld: env.wavesCleared,
      wave: env.wave,
      kills: env.episodeKills,
      bestWave: Math.max(coreBestWave, visibleWavesHeld),
      coreWaves,
      training,
      truncated: env.truncated,
    };
  },
  get gear() { return env.gearInfo(); },
  get pickups() { return env.pickups; },
  setCamera(opts) { debugCam = opts; },
  clearCamera() { debugCam = null; },
  get policyReady() { return policyReady; },
};

try {
  wireUI();
  loadCheckpoint();
  updateCoreUI();
  drawRewardChart();
  updateHUD(1);
  $('hint').innerHTML = modeHints.watch;

  survivor.group.position.set(env.agent.x, 0, env.agent.z);
  prevAgent.set(env.agent.x, 0, env.agent.z);

  // prime async shader compilation with one render, then reveal
  renderer.compile(scene, camera);
  requestAnimationFrame((t) => {
    lastTick = t;
    animate(t);
    setTimeout(() => {
      loader.classList.add('done');
      setTimeout(() => banner('THE HOLLOW GROVE', 'DEFEND THE HOUSE'), 650);
    }, 450);
    // PPO is the only controller and begins learning immediately.
    setTimeout(() => {
      if (!workerStarted && !training) startTraining();
    }, 1200);
  });
} catch (err) {
  console.error(err);
  setLoader('FATAL: ' + err.message);
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
