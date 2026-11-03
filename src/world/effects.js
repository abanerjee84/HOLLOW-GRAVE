import * as THREE from 'three';
import { toon, basic, PALETTE, glowTexture, smokeTexture, addGlowSprite, woodTexture } from './materials.js';

/* ------------------------------------------------------------------ */
/*  Pooled particle + tracer effects                                  */
/* ------------------------------------------------------------------ */
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.tracers = [];
    this.rings = [];
    this.projectiles = [];
    this.splats = [];
    this.time = 0;

    this.glow = glowTexture();
    this.smoke = smokeTexture();

    const poolSize = 160;
    for (let i = 0; i < poolSize; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glow,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.scale.setScalar(0.2);
      scene.add(sprite);
      this.particles.push({
        sprite, life: 0, maxLife: 1, vel: new THREE.Vector3(), gravity: 0,
        startScale: 1, endScale: 0, drag: 0, additive: true,
      });
    }
    this.cursor = 0;
  }

  spawnParticle(opts) {
    const {
      pos, vel = new THREE.Vector3(), life = 0.6, size = 1, endSize = 0,
      color = 0xffffff, gravity = 0, smoke = false, opacity = 1, drag = 0,
    } = opts;
    const p = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;
    p.life = life;
    p.maxLife = life;
    p.vel.copy(vel);
    p.gravity = gravity;
    p.startScale = size;
    p.endScale = endSize;
    p.drag = drag;
    p.sprite.position.copy(pos);
    p.sprite.visible = true;
    p.sprite.material.map = smoke ? this.smoke : this.glow;
    p.sprite.material.color.setHex(color);
    p.sprite.material.opacity = opacity;
    p.sprite.material.blending = smoke ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.sprite.scale.setScalar(size);
    p.smoke = smoke;
    p.opacity = opacity;
    return p;
  }

  flash(pos) {
    this.spawnParticle({
      pos,
      life: 0.09,
      size: 1.6,
      endSize: 0.4,
      color: 0xffd28a,
      opacity: 0.9,
    });
    this.spawnParticle({
      pos,
      life: 0.18,
      size: 1.2,
      endSize: 0,
      color: 0xff9a44,
      opacity: 0.55,
    });
  }

  tracer(from, to, opts = {}) {
    const color = opts.color ?? 0xffd07a;
    const points = [from.clone(), to.clone()];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: opts.opacity ?? 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: opts.life ?? 0.11, maxLife: opts.life ?? 0.11 });
    if (opts.impact) {
      this.flash(to);
      for (let i = 0; i < (opts.sparks ?? 3); i++) {
        this.spawnParticle({
          pos: to.clone(),
          vel: new THREE.Vector3((Math.random() - 0.5) * 7, Math.random() * 5 + 1, (Math.random() - 0.5) * 7),
          life: 0.2 + Math.random() * 0.3,
          size: 0.22 + Math.random() * 0.25,
          endSize: 0,
          color: color,
          gravity: -9,
        });
      }
    }
  }

  muzzle(pos, color = 0xffd28a) {
    this.spawnParticle({
      pos,
      life: 0.07,
      size: 1.35,
      endSize: 0.1,
      color,
      opacity: 1,
    });
    for (let i = 0; i < 2; i++) {
      this.spawnParticle({
        pos: pos.clone(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3),
        life: 0.15,
        size: 0.35,
        endSize: 0,
        color: 0xffb04a,
        gravity: -2,
        smoke: true,
      });
    }
  }

  blood(pos, amount = 10) {
    for (let i = 0; i < amount; i++) {
      this.spawnParticle({
        pos: pos.clone().add(new THREE.Vector3(0, 0.8 + Math.random() * 0.5, 0)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 4.5, Math.random() * 3.5 + 0.5, (Math.random() - 0.5) * 4.5),
        life: 0.35 + Math.random() * 0.35,
        size: 0.22 + Math.random() * 0.3,
        endSize: 0.02,
        color: i % 3 === 0 ? 0xa63b2f : 0x6d211c,
        gravity: -10,
        opacity: 0.9,
      });
    }
    if (Math.random() > 0.4) this.splat(pos);
  }

  splat(pos) {
    const geo = new THREE.CircleGeometry(0.45 + Math.random() * 0.5, 9);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4f1a17,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * 6.28;
    mesh.position.set(pos.x, 0.045, pos.z);
    mesh.scale.x = 0.6 + Math.random() * 0.8;
    this.scene.add(mesh);
    this.splats.push({ mesh, life: 7, maxLife: 7 });
  }

  dust(pos, color = 0xbfb397) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * 6.28;
      this.spawnParticle({
        pos: new THREE.Vector3(pos.x, 0.25 + Math.random() * 0.4, pos.z),
        vel: new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2.5), 0.8 + Math.random() * 1.6, Math.sin(a) * (1 + Math.random() * 2.5)),
        life: 0.5 + Math.random() * 0.4,
        size: 0.5 + Math.random() * 0.6,
        endSize: 1.2,
        color,
        opacity: 0.35,
        smoke: true,
      });
    }
  }

  ring(pos, color = 0xffb35c, radius = 4, life = 0.55) {
    const geo = new THREE.RingGeometry(0.2, 0.32, 32);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.08, pos.z);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, radius });
  }

  explosion(pos) {
    this.ring(pos, 0xffa646, 5.5, 0.7);
    this.flash(new THREE.Vector3(pos.x, 1.0, pos.z));
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * 6.28;
      const speed = 2 + Math.random() * 7;
      this.spawnParticle({
        pos: new THREE.Vector3(pos.x, 0.4 + Math.random() * 0.8, pos.z),
        vel: new THREE.Vector3(Math.cos(a) * speed, 1.5 + Math.random() * 6, Math.sin(a) * speed),
        life: 0.3 + Math.random() * 0.5,
        size: 0.5 + Math.random() * 0.7,
        endSize: 0,
        color: i % 3 === 0 ? 0xffdd88 : i % 3 === 1 ? 0xff943c : 0x9a4a24,
        gravity: -5,
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.28;
      this.spawnParticle({
        pos: new THREE.Vector3(pos.x, 0.6, pos.z),
        vel: new THREE.Vector3(Math.cos(a) * 2, 1 + Math.random() * 3, Math.sin(a) * 2),
        life: 0.8 + Math.random() * 0.7,
        size: 1.2,
        endSize: 2.4,
        color: 0x3a352d,
        smoke: true,
        opacity: 0.4,
        gravity: 1,
      });
    }
  }

  throwProjectile(from, to, onLand) {
    const geo = new THREE.SphereGeometry(0.16, 6, 5);
    const mat = basic(0xffb45c);
    const ball = new THREE.Mesh(geo, mat);
    ball.position.copy(from);
    this.scene.add(ball);
    this.projectiles.push({
      mesh: ball,
      from: from.clone(),
      to: to.clone(),
      t: 0,
      dur: 0.5 + from.distanceTo(to) * 0.035,
      onLand,
    });
    for (let i = 0; i < 5; i++) {
      this.spawnParticle({
        pos: from.clone(),
        vel: new THREE.Vector3(0, 1.2, 0),
        life: 0.3,
        size: 0.3,
        endSize: 0,
        color: 0xff9a44,
        opacity: 0.6,
      });
    }
  }

  update(dt) {
    this.time += dt;
    // particles
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        p.sprite.material.opacity = 0;
        continue;
      }
      const k = 1 - p.life / p.maxLife;
      p.vel.y += p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.sprite.position.addScaledVector(p.vel, dt);
      const s = p.startScale + (p.endScale - p.startScale) * k;
      p.sprite.scale.setScalar(Math.max(0.01, s));
      p.sprite.material.opacity = p.opacity * (1 - k * k);
      if (p.smoke) p.sprite.material.rotation += dt * 0.2;
    }

    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, (t.life / t.maxLife) * 0.8);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }

    // expanding rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.maxLife;
      const s = 0.5 + k * r.radius;
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = Math.max(0, (1 - k) * 0.75);
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
      }
    }

    // splats
    for (let i = this.splats.length - 1; i >= 0; i--) {
      const s = this.splats[i];
      s.life -= dt;
      s.mesh.material.opacity = Math.max(0, Math.min(0.55, s.life / 2));
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        this.splats.splice(i, 1);
      }
    }

    // molotov arcs
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const x = p.from.x + (p.to.x - p.from.x) * k;
      const z = p.from.z + (p.to.z - p.from.z) * k;
      const y = p.from.y + (p.to.y - p.from.y) * k + Math.sin(k * Math.PI) * 4.2;
      p.mesh.position.set(x, y, z);
      p.mesh.rotation.x += dt * 9;
      p.mesh.rotation.z += dt * 6;
      if (Math.random() < 0.7) {
        this.spawnParticle({
          pos: new THREE.Vector3(x, y, z),
          vel: new THREE.Vector3(0, 0.3, 0),
          life: 0.25,
          size: 0.45,
          endSize: 0.05,
          color: 0xff8a34,
          opacity: 0.8,
        });
      }
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        if (p.onLand) p.onLand(new THREE.Vector3(p.to.x, 0, p.to.z));
        this.projectiles.splice(i, 1);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Turret prop                                                       */
/* ------------------------------------------------------------------ */
export function createTurretMesh() {
  const g = new THREE.Group();
  const wood = toon(PALETTE.woodLight, { map: woodTexture() });
  const iron = toon(0x454b44);
  const brass = toon(0xa8874d);

  // tripod
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 1.1, 5), iron);
    leg.position.set(Math.cos(a) * 0.4, 0.5, Math.sin(a) * 0.4);
    leg.rotation.z = Math.cos(a) * 0.32;
    leg.rotation.x = -Math.sin(a) * 0.32;
    leg.castShadow = true;
    g.add(leg);
  }
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.22, 8), wood);
  base.position.y = 1.0;
  base.castShadow = true;
  g.add(base);

  const rot = new THREE.Group();
  rot.position.y = 1.18;
  g.add(rot);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.29, 0.45, 8), iron);
  body.position.y = 0.16;
  body.castShadow = true;
  rot.add(body);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), basic(0xffb95c));
  core.position.y = 0.36;
  rot.add(core);
  const coreGlow = addGlowSprite(rot, 0xffa23c, 1.4, [0, 0.38, 0], 0.55);

  const barrel = new THREE.Group();
  barrel.position.set(0, 0.2, 0.15);
  rot.add(barrel);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.85, 6), brass);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 0.4;
  barrel.add(tube);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 0.84);
  barrel.add(muzzle);

  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 6, 1, true, 0, Math.PI), iron);
  shield.rotation.y = Math.PI / 2;
  shield.rotation.z = Math.PI / 2;
  shield.position.set(0, 0.2, 0.12);
  shield.material.side = THREE.DoubleSide;
  rot.add(shield);

  return { group: g, rot, core, coreGlow, muzzle };
}

/* ------------------------------------------------------------------ */
/*  Crate prop                                                        */
/* ------------------------------------------------------------------ */
export function createCrateMesh() {
  const g = new THREE.Group();
  const wood = toon(0x6b4b2d, { map: woodTexture() });
  const metal = toon(0x3e4640);
  const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), wood);
  boxMesh.position.y = 0.37;
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  g.add(boxMesh);
  for (const s of [-1, 1]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.08, 0.94), metal);
    band.position.y = 0.16 + (s > 0 ? 0.52 : 0);
    band.castShadow = true;
    g.add(band);
  }
  // rivets
  for (const x of [-0.34, 0.34]) {
    for (const z of [-0.34, 0.34]) {
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.045, 4, 3), metal);
      rivet.position.set(x, 0.52, z);
      g.add(rivet);
    }
  }
  const scrap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), toon(0xd2a14b));
  scrap.position.y = 0.78;
  scrap.rotation.set(0.4, 0.7, 0.2);
  g.add(scrap);
  const glow = addGlowSprite(g, 0xffc35e, 2.0, [0, 0.8, 0], 0.65);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.25, 4, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffc35e, transparent: true, opacity: 0.13,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  beam.position.y = 2.2;
  g.add(beam);

  return { group: g, glow, beam, scrap };
}

/* ------------------------------------------------------------------ */
/*  Gear drop prop                                                    */
/* ------------------------------------------------------------------ */
const PICKUP_LOOK = {
  ammo: { color: 0x6f7f4a, glow: 0xc9d68a, beam: 0xa8bf6a },
  weapon: { color: 0x3d4a52, glow: 0x7fd3c8, beam: 0x6fc9bd },
  medkit: { color: 0xd8d3c6, glow: 0xe4705f, beam: 0xd96a5c },
  bomb: { color: 0x8f5a2c, glow: 0xff9a46, beam: 0xff8f3e },
  perk: { color: 0x5a5066, glow: 0xb79ad6, beam: 0xa88fc8 },
};

export function createPickupMesh(kind) {
  const look = PICKUP_LOOK[kind] || PICKUP_LOOK.ammo;
  const g = new THREE.Group();
  const metal = toon(0x3a4139);
  const cloth = toon(0x8f8570);

  // ground marker: a flat ring so the drop reads from a top-down view
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.8, 22),
    new THREE.MeshBasicMaterial({
      color: look.glow, transparent: true, opacity: 0.3,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);

  let float = null;
  let floatBase = 0.75;

  if (kind === 'ammo') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.5), toon(look.color));
    box.position.y = 0.21;
    box.castShadow = true;
    g.add(box);
    for (const x of [-0.16, 0.16]) {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 6), metal);
      shell.position.set(x, 0.55, 0);
      shell.rotation.z = 0.25 * (x > 0 ? -1 : 1);
      g.add(shell);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.14, 6), toon(0xd2a14b));
      tip.position.set(x, 0.76, 0);
      g.add(tip);
    }
    float = null;
  } else if (kind === 'weapon') {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 1.15), metal);
    barrel.position.set(0, 0.28, 0.15);
    barrel.castShadow = true;
    g.add(barrel);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.55), toon(0x6b4b2d));
    stock.position.set(0, 0.24, -0.55);
    stock.rotation.x = 0.16;
    g.add(stock);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.2), metal);
    mag.position.set(0, 0.13, 0.05);
    g.add(mag);
    float = null;
  } else if (kind === 'medkit') {
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.34, 0.44), toon(look.color));
    caseMesh.position.y = 0.17;
    caseMesh.castShadow = true;
    g.add(caseMesh);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.34), toon(0xb03a2e));
    crossV.position.set(0, 0.36, 0);
    g.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.09), toon(0xb03a2e));
    crossH.position.set(0, 0.36, 0);
    g.add(crossH);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.46), cloth);
    strap.position.y = 0.3;
    g.add(strap);
    float = null;
  } else if (kind === 'bomb') {
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.5, 8), toon(0x6f4a2a));
    bottle.position.y = 0.25;
    bottle.castShadow = true;
    g.add(bottle);
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 6), toon(0x8b7250));
    cork.position.y = 0.54;
    g.add(cork);
    const rag = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), cloth);
    rag.position.set(0.06, 0.62, 0.04);
    rag.rotation.set(0.5, 0.3, 0.8);
    g.add(rag);
    float = rag;
    floatBase = 0.62;
  } else {
    // perk: a stone plinth with a floating gem
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.4, 8), toon(0xb6b0a2));
    plinth.position.y = 0.2;
    plinth.castShadow = true;
    g.add(plinth);
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), toon(0x9c7fc4));
    gem.position.y = 0.78;
    gem.rotation.set(0.4, 0.7, 0.2);
    g.add(gem);
    float = gem;
    floatBase = 0.78;
  }

  const glow = addGlowSprite(g, look.glow, 1.7, [0, 0.6, 0], 0.5);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.2, 3.2, 7, 1, true),
    new THREE.MeshBasicMaterial({
      color: look.beam, transparent: true, opacity: 0.12,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  beam.position.y = 1.7;
  g.add(beam);

  return { group: g, glow, beam, ring, float, floatBase };
}

/* ------------------------------------------------------------------ */
/*  Fire zone prop                                                    */
/* ------------------------------------------------------------------ */
export function createFireZone(radius) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff7a2a, transparent: true, opacity: 0.18,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.06;
  g.add(disc);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.9, radius, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffa746, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.07;
  g.add(ring);

  const flames = [];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.SpriteMaterial({
      map: glowTexture(), color: i % 2 ? 0xffa33c : 0xffd787,
      transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const s = new THREE.Sprite(mat);
    const a = (i / 9) * Math.PI * 2;
    const r = (i % 3 === 0 ? 0.3 : 0.7) * radius;
    s.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
    s.scale.setScalar(0.8 + Math.random() * 0.7);
    g.add(s);
    flames.push({ sprite: s, phase: Math.random() * 10, baseX: s.position.x, baseZ: s.position.z, baseScale: s.scale.x });
  }

  const light = new THREE.PointLight(0xff8a3a, 22, radius * 4, 2);
  light.position.y = 1.2;
  g.add(light);

  return { group: g, flames, disc, ring, light };
}
