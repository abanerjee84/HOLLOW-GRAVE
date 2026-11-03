import * as THREE from 'three';
import { PALETTE, toon, basic, addOutline } from './materials.js';

/* ------------------------------------------------------------------ */
/*  Mesh helpers                                                      */
/* ------------------------------------------------------------------ */
function limb(topR, botR, len, mat, seg = 6) {
  const geo = new THREE.CylinderGeometry(topR, botR, len, seg);
  geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeLegs(body, cfg, skinMat, pantsMat, bootMat) {
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.14, 0.92, 0);
    body.add(hip);
    const thigh = limb(0.095, 0.085, 0.44, pantsMat);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    const shin = limb(0.078, 0.065, 0.42, cfg.zombie ? skinMat : pantsMat);
    knee.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, 0.27), bootMat);
    boot.position.set(0, -0.45, 0.05);
    boot.castShadow = true;
    knee.add(boot);
    legs.push({ hip, knee });
  }
  return legs;
}

function makeArms(body, cfg, skinMat, coatMat, sleeveMat) {
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.29, 1.45, 0);
    body.add(shoulder);
    const upper = limb(0.075, 0.065, 0.33, sleeveMat);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.33;
    shoulder.add(elbow);
    const forearm = limb(0.065, 0.055, 0.3, cfg.zombie ? skinMat : sleeveMat);
    elbow.add(forearm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.082, 6, 5), skinMat);
    hand.position.y = -0.32;
    hand.castShadow = true;
    elbow.add(hand);
    arms.push({ shoulder, elbow, hand });
  }
  return arms;
}

/* ------------------------------------------------------------------ */
/*  Survivor                                                          */
/* ------------------------------------------------------------------ */
export function createSurvivor() {
  const root = new THREE.Group();
  root.name = 'mara';

  const skin = toon(PALETTE.skin);
  const coat = toon(PALETTE.coat);
  const coatDark = toon(PALETTE.coatDark);
  const pants = toon(PALETTE.pants);
  const leather = toon(PALETTE.leather);
  const scarf = toon(0xc19a52);
  const metal = toon(0x545b56);
  const hair = toon(0x2a1e18);

  const body = new THREE.Group();
  root.add(body);
  body.name = 'body';

  // torso
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.62, 7), coat);
  torso.position.y = 1.28;
  torso.castShadow = true;
  torso.receiveShadow = true;
  body.add(torso);

  // coat skirt
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.43, 0.56, 8, 1, true), coat);
  skirt.position.y = 0.88;
  skirt.castShadow = true;
  skirt.material.side = THREE.DoubleSide;
  body.add(skirt);
  const skirtDark = new THREE.Mesh(new THREE.CylinderGeometry(0.285, 0.435, 0.57, 8, 1, true), coatDark);
  skirtDark.position.y = 0.885;
  skirtDark.scale.setScalar(0.985);
  body.add(skirtDark);

  // belt + satchel
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.272, 0.275, 0.11, 8), leather);
  belt.position.y = 1.05;
  body.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.04), toon(0xb08b4a));
  buckle.position.set(0, 1.05, 0.275);
  buckle.userData.noOutline = true;
  body.add(buckle);
  const satchel = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.14), leather);
  satchel.position.set(0.3, 0.98, -0.1);
  satchel.rotation.z = 0.15;
  satchel.castShadow = true;
  body.add(satchel);
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.04), leather);
  strap.position.set(0.06, 1.29, 0.21);
  strap.rotation.z = -0.55;
  body.add(strap);

  // shoulder mantle
  const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.17, 8), coatDark);
  mantle.position.y = 1.5;
  body.add(mantle);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.23, 0.12, 8), scarf);
  collar.position.y = 1.6;
  body.add(collar);

  // head
  const head = new THREE.Group();
  head.position.y = 1.74;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.215, 9, 7), skin);
  skull.scale.set(0.92, 1.02, 0.95);
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 5), skin);
  jaw.position.set(0, -0.1, 0.08);
  jaw.scale.set(0.9, 0.7, 0.8);
  head.add(jaw);
  // eyes
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), basic(0x1a1512));
    eye.position.set(s * 0.075, 0.015, 0.19);
    eye.userData.noOutline = true;
    head.add(eye);
  }
  // hair strands
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.225, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.72), hair);
  hairBack.position.set(0, 0.03, -0.02);
  hairBack.scale.set(0.94, 1.02, 0.96);
  head.add(hairBack);

  // hat
  const hat = new THREE.Group();
  hat.position.set(0, 1.94, -0.01);
  hat.rotation.z = 0.035;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.46, 0.055, 14), toon(0xc5a564));
  brim.position.y = 0;
  brim.castShadow = true;
  hat.add(brim);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.22, 10), toon(0xb89652));
  crown.position.y = 0.15;
  crown.castShadow = true;
  hat.add(crown);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.223, 0.228, 0.055, 10), toon(0x8c3f33));
  band.position.y = 0.055;
  hat.add(band);
  const feather = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.48, 4), toon(0xd9cba6));
  feather.position.set(0.13, 0.2, -0.12);
  feather.rotation.z = -0.5;
  feather.rotation.x = -0.4;
  hat.add(feather);
  head.add(hat);
  hat.position.y = 0.2;

  // scarf tail
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, 0.06), scarf);
  scarfTail.position.set(-0.12, 1.44, -0.22);
  scarfTail.rotation.z = 0.15;
  body.add(scarfTail);

  // arms
  const arms = makeArms(body, { zombie: false }, skin, coat, coat);

  // weapon (pistol / carbine)
  const gun = new THREE.Group();
  gun.position.set(0.18, 1.27, 0.28);
  body.add(gun);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.32), leather);
  stock.position.set(0, -0.01, -0.1);
  gun.add(stock);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.26), metal);
  receiver.position.set(0, 0.03, 0.12);
  gun.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.46, 6), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.055, 0.42);
  gun.add(barrel);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.055, 0.68);
  gun.add(muzzle);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.06), metal);
  sight.position.set(0, 0.13, 0.18);
  gun.add(sight);

  // pose arms to hold the weapon
  arms[1].shoulder.rotation.set(-1.02, 0, -0.18);
  arms[1].elbow.rotation.set(-0.28, 0.25, 0);
  arms[0].shoulder.rotation.set(-0.92, 0.25, 0.34);
  arms[0].elbow.rotation.set(-0.5, -0.55, 0);

  // selection ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.72, 24),
    new THREE.MeshBasicMaterial({ color: 0xd8ab63, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.035;
  root.add(ring);

  // ground shadow blob
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 16),
    new THREE.MeshBasicMaterial({ color: 0x0a0f0a, transparent: true, opacity: 0.3, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  root.add(blob);

  // outline the silhouette, not the trinkets
  for (const m of [buckle, strap, sight, ring, blob]) m.userData.noOutline = true;

  addOutline(root, 1.06);

  const parts = { body, head, torso, arms, legs: makeLegs(body, { zombie: false }, skin, pants, leather), gun, muzzle, ring, skirt };

  const char = {
    group: root,
    parts,
    walk: 0,
    fireKick: 0,
    kind: 'survivor',
    update(dt, t, opts = {}) {
      const { speed = 0, aim = 0, firing = false, dead = false } = opts;
      const amp = Math.min(1, speed / 4);
      if (!dead) {
        this.walk += dt * (2.4 + speed * 1.55) * (amp > 0.02 ? 1 : 0.25);
      }
      const swing = Math.sin(this.walk);
      const bob = Math.abs(Math.sin(this.walk * 2)) * 0.045 * amp;

      body.position.y = bob + Math.sin(t * 1.7) * 0.008;
      body.rotation.z = swing * 0.025 * amp;

      // smooth facing
      let d = aim - root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      root.rotation.y += d * Math.min(1, dt * 13);

      const legs = parts.legs;
      legs[0].hip.rotation.x = swing * 0.72 * amp;
      legs[1].hip.rotation.x = -swing * 0.72 * amp;
      legs[0].knee.rotation.x = Math.max(0, -swing) * 0.6 * amp;
      legs[1].knee.rotation.x = Math.max(0, swing) * 0.6 * amp;

      // torso lean into movement
      torso.rotation.x = amp * 0.06;

      // arms sway subtly while keeping the weapon up
      const hold = -1.02;
      parts.arms[1].shoulder.rotation.x = hold + swing * 0.06 * amp;
      parts.arms[0].shoulder.rotation.x = -0.92 + swing * 0.05 * amp;

      // firing recoil
      if (firing) this.fireKick = 1;
      this.fireKick = Math.max(0, this.fireKick - dt * 9);
      const kick = this.fireKick * this.fireKick;
      gun.position.z = 0.28 - kick * 0.11;
      gun.position.y = 1.27 - kick * 0.015;
      body.rotation.x = -kick * 0.03;

      // target ring pulse
      ring.material.opacity = 0.16 + Math.sin(t * 2.4) * 0.045;

      if (dead) {
        body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, 1.3, dt * 3);
        body.position.y -= dt * 0.4;
      }
    },
    getMuzzleWorld(target = new THREE.Vector3()) {
      return parts.muzzle.getWorldPosition(target);
    },
    reset() {
      body.rotation.set(0, 0, 0);
      body.position.set(0, 0, 0);
      root.position.y = 0;
      root.rotation.set(0, 0, 0);
      this.walk = 0;
      this.fireKick = 0;
    },
  };

  return char;
}

/* ------------------------------------------------------------------ */
/*  Zombie                                                            */
/* ------------------------------------------------------------------ */
const ZOMBIE_SKINS = [0x81986a, 0x90a477, 0x748b60, 0x9aa87e];
const ZOMBIE_SHIRTS = [0x5a5546, 0x4a4038, 0x3c4a3d, 0x54443b];
const ZOMBIE_PANTS = [0x33382f, 0x3d3a31, 0x2c3230];

export function createZombie(variant = 0, opts = {}) {
  const rnd = (() => {
    let s = 1000 + variant * 77;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  })();

  const root = new THREE.Group();
  root.name = 'zombie';
  const scale = opts.brute ? 1.22 : 0.92 + rnd() * 0.16;
  root.scale.setScalar(scale);

  const skin = toon(ZOMBIE_SKINS[variant % ZOMBIE_SKINS.length]);
  const shirt = toon(ZOMBIE_SHIRTS[variant % ZOMBIE_SHIRTS.length]);
  const shirtDark = toon(0x352f2a);
  const pants = toon(ZOMBIE_PANTS[variant % ZOMBIE_PANTS.length]);
  const leather = toon(0x2a231c);
  const hair = toon(0x211b16);
  const blood = toon(0x5c241f);

  const body = new THREE.Group();
  body.rotation.x = 0.14 + rnd() * 0.1;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.58, 7), shirt);
  torso.position.y = 1.26;
  torso.castShadow = true;
  torso.receiveShadow = true;
  body.add(torso);

  // torn hem
  const hem = new THREE.Mesh(new THREE.ConeGeometry(0.29, 0.28, 7, 1, true), shirtDark);
  hem.position.y = 0.94;
  body.add(hem);

  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.25, 0.08, 7), leather);
  belt.position.y = 1.0;
  body.add(belt);

  // bloodstain
  const stain = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), blood);
  stain.position.set(0.08, 1.25, 0.16);
  stain.scale.set(1.2, 1.4, 0.35);
  body.add(stain);

  const head = new THREE.Group();
  head.position.set(0, 1.66, 0.02);
  head.rotation.z = (rnd() - 0.5) * 0.4;
  head.rotation.x = 0.1 + rnd() * 0.18;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.21, 8, 6), skin);
  skull.scale.set(0.9, 1.05, 0.92);
  skull.castShadow = true;
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), skin);
  jaw.position.set(0, -0.1, 0.07);
  jaw.scale.set(0.9, 0.65, 0.9);
  head.add(jaw);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.035, 0.04), basic(0x201512));
  mouth.position.set(0, -0.115, 0.17);
  head.add(mouth);
  // glowing eyes
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 5, 4), basic(0xd86a4a));
    eye.position.set(s * 0.07, 0.02, 0.18);
    eye.userData.noOutline = true;
    head.add(eye);
  }
  const hairPatch = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), hair);
  hairPatch.position.set(0.02, 0.07, -0.03);
  head.add(hairPatch);

  const arms = makeArms(body, { zombie: true }, skin, shirt, shirt);
  // reach forward
  arms[0].shoulder.rotation.set(-1.25, 0, 0.12);
  arms[0].elbow.rotation.set(-0.35, 0, 0);
  arms[1].shoulder.rotation.set(-1.12, 0, -0.18);
  arms[1].elbow.rotation.set(-0.2, 0, 0);

  const legs = makeLegs(body, { zombie: true }, skin, pants, leather);

  // exposed ribs / wound
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.03), toon(0xc9c0a2));
    rib.position.set(-0.06, 1.14 + i * 0.06, 0.2);
    rib.rotation.z = -0.15;
    rib.userData.noOutline = true;
    body.add(rib);
  }

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.47, 12),
    new THREE.MeshBasicMaterial({ color: 0x0a0f0a, transparent: true, opacity: 0.28, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  blob.userData.noOutline = true;
  root.add(blob);

  // the outline reads the silhouette only — skip the small detail meshes
  for (const m of [hem, belt, stain, jaw, mouth, hairPatch]) m.userData.noOutline = true;

  addOutline(root, 1.055);

  // unique materials for hit flashes
  const mats = new Set();
  root.traverse((o) => {
    if (o.isMesh && o.material && o.material.side !== THREE.BackSide) {
      const m = o.material.clone();
      if (m.emissive) m.emissive = new THREE.Color(0x000000);
      o.material = m;
      mats.add(m);
    }
  });

  const char = {
    group: root,
    parts: { body, head, torso, arms, legs },
    kind: 'zombie',
    walk: rnd() * 6,
    flashT: 0,
    dead: false,
    deadT: 0,
    mats: [...mats],
    update(dt, t, o = {}) {
      const { speed = 1, dead = false } = o;
      if (dead) {
        this.deadT += dt;
        root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, -1.45, dt * 4);
        if (this.deadT > 1.2) root.position.y -= dt * 0.9;
        return;
      }
      this.walk += dt * (1.8 + speed * 1.7);
      const swing = Math.sin(this.walk);
      const amp = Math.min(1, 0.3 + speed * 0.25);

      body.position.y = Math.abs(Math.sin(this.walk * 2)) * 0.03;
      body.rotation.z = swing * 0.055;
      body.rotation.x = 0.16 + Math.sin(t * 0.7 + variant) * 0.02;

      legs[0].hip.rotation.x = swing * 0.6;
      legs[1].hip.rotation.x = -swing * 0.6;
      legs[0].knee.rotation.x = Math.max(0, -swing) * 0.55;
      legs[1].knee.rotation.x = Math.max(0, swing) * 0.55;

      arms[0].shoulder.rotation.x = -1.25 + Math.sin(this.walk + 0.5) * 0.12;
      arms[1].shoulder.rotation.x = -1.12 - Math.sin(this.walk) * 0.1;
      arms[0].shoulder.rotation.z = 0.12 + Math.sin(t * 0.8) * 0.04;
      head.rotation.z = -0.15 + Math.sin(t * 0.9 + variant) * 0.12;
      head.rotation.y = Math.sin(t * 0.55 + variant * 2) * 0.2;

      this.flashT = Math.max(0, this.flashT - dt);
      if (this.flashT > 0) {
        for (const m of this.mats) if (m.emissive) m.emissive.setHex(0x8a2218);
      } else {
        for (const m of this.mats) if (m.emissive) m.emissive.setHex(0x000000);
      }
    },
    flash() { this.flashT = 0.1; },
    die() {
      this.dead = true;
      root.rotation.x = 0;
    },
    setOpacity() {},
  };
  return char;
}
