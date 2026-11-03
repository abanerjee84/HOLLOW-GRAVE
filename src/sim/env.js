/* Pure simulation for Hollow Grove. Shared by the renderer and the PPO worker. */

export const MOVE_COUNT = 9;
export const COMBAT_COUNT = 8;

export const MOVE_DIRS = [
  [0, 0], [0, -1], [0.7071, -0.7071], [1, 0], [0.7071, 0.7071],
  [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071],
];

export const COMBAT = {
  NONE: 0, FIRE: 1, CYCLE: 2, TURRET: 3, MOLOTOV: 4, DASH: 5, MEDKIT: 6, RELOAD: 7,
};

export const UTILITY = { NONE: 0, TURRET: 1, MOLOTOV: 2, DASH: 3, MEDKIT: 4, RELOAD: 5 };
export const UTILITY_NAMES = ['Wait', 'Build turret', 'Firebomb', 'Dash', 'Medkit', 'Reload'];
export const ACTION_HEADS = [
  { name: 'move', size: 9 }, { name: 'weapon', size: 4 },
  { name: 'fire', size: 2 }, { name: 'utility', size: 6 },
];

/* The inventory. Slots are indexed; the agent carries what it has found. */
export const WEAPONS = [
  { id: 'sidearm', name: 'Sidearm', shot: 'pistol', dmg: 10, range: 18, cone: 0.13, cd: 0.3, mag: Infinity, reserve: Infinity, reload: 0 },
  { id: 'shotgun', name: 'Shotgun', shot: 'shotgun', dmg: 7, range: 8.5, cone: 0.38, cd: 0.7, mag: 8, reserve: 26, reload: 1.7 },
  { id: 'rifle', name: 'Rifle', shot: 'rifle', dmg: 13, range: 24, cone: 0.09, cd: 0.24, mag: 14, reserve: 34, reload: 1.35 },
];

export const PICKUP_KINDS = ['ammo', 'weapon', 'medkit', 'bomb', 'perk'];
export const PERKS = ['vigor', 'swift', 'steady', 'scavenger'];
export const PERK_NAMES = {
  vigor: 'Vigor · +25 vitality',
  swift: 'Swift · +18% pace',
  steady: 'Steady · −22% dwell',
  scavenger: 'Scavenger · +60% salvage',
};

/* Observation layout. The policy sees every soul inside the sight radius with
   its distance and bearing, the horde beyond that radius in aggregate, the
   whole weapon inventory, and the way back to the manor. The sizes are derived
   here so the network always matches exactly what getObservation() writes. */
export const OBS_SELF = 11;
export const OBS_INVENTORY = WEAPONS.length * 4 + 2 + WEAPONS.length + 3 + PERKS.length;
export const OBS_ZOMBIE_SLOTS = 16;   // one slot per soul the field can hold at once
export const OBS_ZOMBIE_FIELDS = 9;
export const OBS_HORDE = 4;
export const OBS_HOUSE = 3;
export const OBS_TURRETS = 4 * 5;
export const OBS_CRATES = 4 * 3;
export const OBS_PICKUPS = 3 * 4;
export const OBS_FIRES = 2 * 4;
export const OBS_ROUTE = 4;
export const OBS_COUNTS = 6;
export const OBS_BASE_SIZE = OBS_SELF + OBS_INVENTORY
  + OBS_ZOMBIE_SLOTS * OBS_ZOMBIE_FIELDS
  + OBS_HORDE + OBS_HOUSE + OBS_TURRETS + OBS_CRATES
  + OBS_PICKUPS + OBS_FIRES + OBS_ROUTE + OBS_COUNTS;
export const EXTRA_FIELDS = [
  'scrap', 'wave', 'quota', 'spawned', 'episodeTime', 'spawnTimer', 'pickupTimer',
  'maxHp', 'medCd', 'molotovCd', 'dashT', 'invuln', 'regenT', 'turretCd',
  ...WEAPONS.map(w => `reload_${w.id}`),
  ...Array.from({ length: OBS_ZOMBIE_SLOTS }, (_, k) =>
    ['present', 'dx', 'dz', 'maxHp', 'damage', 'radius', 'gateLane', 'doorLane'].map(f => `z${k}_${f}`)).flat(),
  ...Array.from({ length: 3 }, (_, k) =>
    ['ammo', 'weapon', 'medkit', 'bomb', 'perk', ...PERKS].map(f => `pickup${k}_${f}`)).flat(),
  'fire0_phase', 'fire1_phase',
];
export const OBS_EXTRA = Object.fromEntries(EXTRA_FIELDS.map((field, k) => [field, OBS_BASE_SIZE + k]));
export const OBS_SIZE = OBS_BASE_SIZE + EXTRA_FIELDS.length;

export const CFG = {
  gamma: 0.99,
  arenaHalf: 30,
  houseZ: -21,
  gateZ: -11,
  doorX: 0,
  doorZ: -13.6,
  houseMaxHp: 100,
  agentMaxHp: 100,
  agentSpeed: 4.6,
  agentRadius: 0.55,
  startScrap: 60,
  /* Weapon inventory lives in WEAPONS; these are the gear economy. */
  ammoBox: 14,
  reserveCap: 60,
  medkitHeal: 34,
  medkitMax: 3,
  bombMax: 4,
  swapCd: 0.28,
  turretCost: 25,
  turretHp: 60,
  turretRange: 15,
  turretDamage: 7,
  turretCd: 0.55,
  maxTurrets: 4,
  molotovCost: 18,
  molotovCd: 5,
  molotovRange: 6,
  fireRadius: 2.7,
  fireDps: 16,
  fireDur: 5,
  dashCd: 2.6,
  dashSpeed: 11.5,
  dashTime: 0.26,
  crateValue: 12,
  crateInterval: 5.5,
  maxCrates: 4,
  pickupInterval: 6.5,
  maxPickups: 3,
  pickupRadius: 1.5,
  /* An episode is the whole defence: waves escalate inside it, and it ends
     only when Mara falls or the house does. A wave is a bounded quota. */
  waveBase: 9,
  waveGrowth: 2,
  waveQuotaMax: 56,
  maxZombies: 16,      // concurrent souls on the field
  sightRadius: 26,     // how far Mara perceives; souls past it are aggregated
  zombieMaxHp: 310,    // 100 * (1 + 2.1)
  zombieMaxSpeed: 3.75,
  spawnInterval: 1.25,
  waveRest: 2.4,       // breathing room before the horde of a wave walks in
  maxEpisodeTime: 480,   // safety cap in seconds of simulated defence; truncates, never terminates
  reward: {
    survival: -0.01,   // small time cost; waiting alone cannot farm reward
    damage: 0.05,
    kills: { walker: 4.5, runner: 5.5, brute: 13 },
    scrap: 0,          // repeatable resources use potential shaping in step()
    pickup: 0,
    foundWeapon: 15,    // a rifle recovered from the field
    foundPerk: 20,      // a perk claimed
    usedMedkit: 0,      // healing is useful through health preservation
    turretBuilt: 0,     // reward the resulting damage and kills
    molotovThrown: 0,
    waveClear: 9,
    integrity: 12,     // scaled by house health left when the wave is held
    vitality: 8,       // scaled by Mara's health left when the wave is held
    agentHurt: -0.4,
    houseHurt: -0.7,
    death: -22,
    houseLost: -26,
  },
};

/* Size of the horde for a given wave. Grows until the hard cap. */
export function waveQuota(wave) {
  return Math.min(CFG.waveQuotaMax, CFG.waveBase + Math.floor((wave - 1) * CFG.waveGrowth));
}

const ZOMBIE_TYPES = {
  walker: { hp: 32, speed: 1.35, dmg: 8, scrap: 5, radius: 0.42 },
  runner: { hp: 22, speed: 2.5, dmg: 6, scrap: 6, radius: 0.36 },
  brute: { hp: 100, speed: 1.0, dmg: 17, scrap: 14, radius: 0.62 },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function len2(x, z) { return Math.sqrt(x * x + z * z); }
function angleDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const HOUSE_RECT = { x0: -7.6, x1: 7.6, z0: -26.5, z1: -15.2 };

export function tacticalControl(action) {
  const [mx, mz] = MOVE_DIRS[action.move] || [0, 0];
  return { mx, mz, aim: null, weapon: action.weapon > 0 ? action.weapon - 1 : null,
    fire: !!action.fire, cycle: false, buildTurret: action.utility === UTILITY.TURRET,
    throwMolotov: action.utility === UTILITY.MOLOTOV, dash: action.utility === UTILITY.DASH,
    medkit: action.utility === UTILITY.MEDKIT, reload: action.utility === UTILITY.RELOAD };
}

// Masks must be identical when sampling and recomputing PPO log probabilities.
// Cooldowns expiring within the held 0.2s action remain actionable.
export function actionMasks(obs, selectedWeapon = 0) {
  const owned = k => obs[OBS_SELF + k * 4] > 0.5;
  const current = [0, 1, 2].find(k => obs[OBS_SELF + 14 + k] > 0.5) ?? 0;
  const weapon = [1, ...WEAPONS.map((_, k) => owned(k) && (k === current || obs[OBS_SELF + 13] * CFG.swapCd <= 0.2) ? 1 : 0)];
  const k = selectedWeapon > 0 ? selectedWeapon - 1 : current;
  const w = WEAPONS[k], base = OBS_SELF + k * 4;
  const reload = obs[OBS_EXTRA[`reload_${w.id}`]] * w.reload;
  const ready = reload <= 0.2 && obs[base + 3] * w.cd <= 0.2;
  const hasAmmo = w.mag === Infinity || obs[base + 1] > 0 || obs[base + 2] > 0;
  const scrap = obs[OBS_EXTRA.scrap] * 999;
  const inventoryTail = OBS_SELF + 17;
  const countOffset = OBS_BASE_SIZE - OBS_COUNTS;
  const utility = [1,
    +(scrap >= CFG.turretCost - 1e-4 && obs[countOffset] < 1 && obs[OBS_EXTRA.turretCd] * 0.7 <= 0.2),
    +((obs[inventoryTail] > 0 || scrap >= CFG.molotovCost - 1e-4) && obs[OBS_EXTRA.molotovCd] * CFG.molotovCd <= 0.2),
    +(obs[6] * CFG.dashCd <= 0.2),
    +(obs[inventoryTail + 1] > 0 && obs[2] < 1 && obs[OBS_EXTRA.medCd] <= 0.2),
    +(w.mag !== Infinity && obs[base + 1] < 1 && obs[base + 2] > 0 && reload <= 0),
  ];
  return { move: Array(9).fill(1), weapon, fire: [1, +(ready && hasAmmo)], utility };
}

export class Env {
  constructor(opts = {}) {
    this.seed = opts.seed ?? ((Math.random() * 1e9) | 0);
    this.rng = mulberry32(this.seed);
    this.events = opts.events !== false;
    this.training = !!opts.training;
    this.reset(this.seed);
  }

  reset(seed = this.seed, opts = {}) {
    this.seed = seed;
    this.rng = mulberry32(seed);
    const rnd = this.rng;
    const startWave = Math.max(1, opts.startWave ?? 1);

    this.time = 0;
    this.lastTurretTime = -Infinity;
    this.control = null;
    this.done = false;
    this.truncated = false;
    this.outcome = null;
    this.wave = startWave;
    this.waveQuota = waveQuota(startWave);
    this.waveSpawned = 0;
    this.waveKills = 0;
    this.waveKilled = 0;
    this.wavesCleared = 0;
    this.spawnTimer = opts.immediate ? 0.4 : CFG.waveRest;
    this.stepCount = 0;
    this.episodeReward = 0;
    this.episodeKills = 0;
    this.houseHp = CFG.houseMaxHp;
    this.scrapCollected = 0;
    this.damageDealt = 0;
    this.agentDamageTaken = 0;
    this.houseDamageTaken = 0;

    const carried = opts.keepGear ? this.agent : null;

    this.agent = {
      x: (rnd() - 0.5) * 6,
      z: 8 + rnd() * 5,
      hp: CFG.agentMaxHp,
      maxHp: carried ? Math.max(CFG.agentMaxHp, carried.maxHp) : CFG.agentMaxHp,
      scrap: carried ? carried.scrap : CFG.startScrap,
      aim: 0,
      // inventory: one slot per WEAPONS entry
      weapon: carried ? carried.weapon : 0,
      swapCd: 0,
      weapons: WEAPONS.map((w, i) => {
        const prev = carried ? carried.weapons[i] : null;
        return {
          owned: prev ? prev.owned : w.id !== 'rifle',   // the rifle must be found in the field
          mag: prev ? prev.mag : (w.id === 'rifle' ? 0 : w.mag),
          reserve: prev ? prev.reserve : (w.id === 'rifle' ? 0 : w.reserve),
          cd: 0,
          reloadT: 0,
        };
      }),
      bombs: carried ? carried.bombs : 2,
      medkits: carried ? carried.medkits : 1,
      medCd: 0,
      perks: carried ? { ...carried.perks } : {},
      perkCount: carried ? carried.perkCount : 0,
      speedMul: carried ? carried.speedMul : 1,
      cdMul: carried ? carried.cdMul : 1,
      reloadMul: carried ? carried.reloadMul : 1,
      salvageMul: carried ? carried.salvageMul : 1,
      molotovCd: 0,
      dashCd: 0,
      dashT: 0,
      hurtT: 0,
      regenT: 0,
      lastHurt: 0,
      invuln: 0,
      manual: false,
    };

    // vitality carries forward, but the survivor recovers between waves
    if (carried) this.agent.hp = Math.min(this.agent.maxHp, Math.max(35, carried.hp));

    this.zombies = [];
    this.turrets = [];
    this.crates = [];
    this.pickups = [];
    this.pickupTimer = 3.5;
    this.fires = [];
    this.nextId = 1;
    this.pendingReward = 0;
    this.rewardParts = { kill: 0, damage: 0, survival: 0, scrap: 0, gear: 0, resource: 0, hurt: 0, house: 0, wave: 0, bonus: 0 };
    this.lastKill = null;

    this.eventsBuf = [];
    this.spawnCrate(true);
    this.spawnCrate(true);
    this.spawnCrate(true);
    this.emit({ type: 'wave', wave: startWave, quota: this.waveQuota });
    return this.getObservation();
  }

  emit(ev) {
    if (this.events) this.eventsBuf.push(ev);
  }

  /* ------------------------------------------------------------------ */
  /*  Observation                                                        */
  /* ------------------------------------------------------------------ */
  getObservation() {
    const obs = new Float32Array(OBS_SIZE);
    let i = 0;
    const a = this.agent;
    const push = (v) => { if (i >= OBS_SIZE) throw new Error("Observation overflow"); obs[i++] = v; };

    push(a.x / 30);
    push(a.z / 30);
    push(a.hp / a.maxHp);
    push(Math.min(1, a.scrap / 60));
    push(Math.sin(a.aim));
    push(Math.cos(a.aim));
    push(Math.min(1, a.dashCd / CFG.dashCd));
    push(this.houseHp / CFG.houseMaxHp);
    push(Math.min(1, this.wave / 24));
    push(this.waveQuota ? Math.min(1, this.waveKilled / this.waveQuota) : 0);
    push(Math.min(1, a.lastHurt / 4));

    // weapon inventory: owned, magazine, reserve, cooldown for each slot
    for (let k = 0; k < WEAPONS.length; k++) {
      const ws = a.weapons[k];
      const w = WEAPONS[k];
      push(ws.owned ? 1 : 0);
      push(w.mag === Infinity ? 1 : clamp(ws.mag / w.mag, 0, 1));
      push(w.reserve === Infinity ? 1 : clamp(ws.reserve / CFG.reserveCap, 0, 1));
      push(clamp(ws.cd / w.cd, 0, 1));
    }
    const cur = a.weapons[a.weapon];
    const curW = WEAPONS[a.weapon];
    push(curW.reload > 0 ? clamp(cur.reloadT / curW.reload, 0, 1) : 0);
    push(Math.min(1, a.swapCd / CFG.swapCd));
    for (let k = 0; k < WEAPONS.length; k++) push(a.weapon === k ? 1 : 0);
    push(Math.min(1, a.bombs / CFG.bombMax));
    push(Math.min(1, a.medkits / CFG.medkitMax));
    push(a.perkCount / PERKS.length);
    push(a.perks.vigor ? 1 : 0);
    push(a.perks.swift ? 1 : 0);
    push(a.perks.steady ? 1 : 0);
    push(a.perks.scavenger ? 1 : 0);

    // Every soul on the field, nearest first: distance and bearing from Mara.
    // The leading flag marks whether it sits inside her sight radius — souls
    // beyond it are still located, they just are not a threat she can read yet.
    const sight = CFG.sightRadius;
    const souls = this.zombies
      .map((z) => {
        const dx = z.x - a.x, dz = z.z - a.z;
        return { z, dx, dz, d: len2(dx, dz) };
      })
      .sort((p, q) => p.d - q.d);
    for (let k = 0; k < OBS_ZOMBIE_SLOTS; k++) {
      const s = souls[k];
      if (s) {
        const inv = 1 / Math.max(s.d, 0.001);
        push(s.d <= sight ? 1 : 0);          // inside sight radius
        push(Math.min(1, s.d / CFG.arenaHalf));
        push(s.dx * inv);                    // bearing, x component
        push(s.dz * inv);                    // bearing, z component
        push(clamp(s.z.hp / CFG.zombieMaxHp, 0, 1));
        push(clamp(s.z.speed / CFG.zombieMaxSpeed, 0, 1));
        push(s.z.typeIndex / 2);
        push(Math.min(1, s.z.attackCd / 1.2));
        push(s.z.aggro ? 1 : 0);
      } else {
        for (let f = 0; f < OBS_ZOMBIE_FIELDS; f++) push(0);
      }
    }

    // Horde summary: souls on the field, how many are in sight, and the
    // bearing of the pack as a whole.
    push(Math.min(1, this.zombies.length / CFG.maxZombies));
    let inside = 0;
    for (const s of souls) if (s.d <= sight) inside += 1;
    push(Math.min(1, inside / CFG.maxZombies));
    let hx = 0, hz = 0;
    for (const z of this.zombies) { hx += z.x - a.x; hz += z.z - a.z; }
    if (this.zombies.length) {
      const d = Math.max(len2(hx, hz), 0.001);
      push(hx / d);
      push(hz / d);
    } else {
      push(0); push(0);
    }

    // The way home to the manor.
    const wayX = CFG.doorX - a.x, wayZ = CFG.houseZ - a.z;
    const wayD = Math.max(len2(wayX, wayZ), 0.001);
    push(Math.min(1, wayD / 30));
    push(wayX / wayD);
    push(wayZ / wayD);

    // Every turret the field can hold.
    for (let k = 0; k < CFG.maxTurrets; k++) {
      const t = this.turrets[k];
      if (t) {
        push((t.x - a.x) / 62);
        push((t.z - a.z) / 62);
        push(t.hp / CFG.turretHp);
        push(Math.min(1, t.cd / CFG.turretCd));
        push(1);
      } else {
        push(0); push(0); push(0); push(0); push(0);
      }
    }

    // Every crate the field can hold.
    for (let k = 0; k < CFG.maxCrates; k++) {
      const c = this.crates[k];
      if (c) {
        push((c.x - a.x) / 62);
        push((c.z - a.z) / 62);
        push(1);
      } else {
        push(0); push(0); push(0);
      }
    }

    // three closest pickups
    const ps = this.pickups
      .filter((p) => p.active)
      .sort((p, q) => (p.x - a.x) ** 2 + (p.z - a.z) ** 2 - ((q.x - a.x) ** 2 + (q.z - a.z) ** 2))
      .slice(0, 3);
    for (let k = 0; k < 3; k++) {
      const p = ps[k];
      if (p) {
        push((p.x - a.x) / 62);
        push((p.z - a.z) / 62);
        push(PICKUP_KINDS.indexOf(p.kind) / 4);
        push(1);
      } else {
        push(0); push(0); push(0); push(0);
      }
    }

    // fires
    for (let k = 0; k < 2; k++) {
      const f = this.fires[k];
      if (f) {
        push((f.x - a.x) / 62);
        push((f.z - a.z) / 62);
        push(f.r / 4);
        push(f.t / CFG.fireDur);
      } else {
        push(0); push(0); push(0); push(0);
      }
    }

    // route info
    push((0 - a.x) / 30);
    push((CFG.gateZ - a.z) / 30);
    push((0 - a.x) / 30);
    push((CFG.doorZ - a.z) / 30);

    // counts / wave state
    push(this.turrets.length / CFG.maxTurrets);
    push(this.waveQuota ? Math.min(1, this.zombies.length / this.waveQuota) : 0);
    push(this.waveQuota ? Math.min(1, (this.waveQuota - this.waveSpawned) / this.waveQuota) : 0);
    let nearest = 30;
    for (const z of this.zombies) nearest = Math.min(nearest, len2(z.x - a.x, z.z - a.z));
    push(nearest / 30);
    let nearestGear = 30;
    for (const p of this.pickups) {
      if (!p.active) continue;
      nearestGear = Math.min(nearestGear, len2(p.x - a.x, p.z - a.z));
    }
    push(nearestGear / 30);
    push(this.pickups.filter((p) => p.active).length / CFG.maxPickups);

    // Additional transition state. Visual-only state and RNG internals are excluded.
    const extras = [
      a.scrap / 999, this.wave / (this.wave + 24), this.waveQuota / CFG.waveQuotaMax,
      this.waveSpawned / CFG.waveQuotaMax, this.time / CFG.maxEpisodeTime,
      clamp(this.spawnTimer / 3.5, 0, 1), clamp(this.pickupTimer / (CFG.pickupInterval * 1.4), 0, 1),
      a.maxHp / 125, a.medCd, a.molotovCd / CFG.molotovCd,
      Math.max(0, a.dashT) / CFG.dashTime, a.invuln / 0.3, Math.min(1, a.regenT / 3.5),
      clamp((0.7 - (this.time - this.lastTurretTime)) / 0.7, 0, 1),
      ...a.weapons.map((slot, k) => WEAPONS[k].reload ? slot.reloadT / WEAPONS[k].reload : 0),
    ];
    for (let k = 0; k < OBS_ZOMBIE_SLOTS; k++) {
      const soul = souls[k];
      extras.push(...(soul ? [1, soul.dx / 62, soul.dz / 62,
        soul.z.maxHp / CFG.zombieMaxHp || 0, soul.z.dmg / 32 || 0,
        soul.z.radius || 0, ((soul.z.id * 37) % 9 - 4) / 4 || 0,
        ((soul.z.id * 53) % 7 - 3) / 3 || 0] : Array(8).fill(0)));
    }
    for (let k = 0; k < 3; k++) {
      const pickup = ps[k];
      extras.push(...PICKUP_KINDS.map(kind => pickup?.kind === kind ? 1 : 0));
      extras.push(...PERKS.map(perk => pickup?.kind === 'perk' && pickup.payload === perk ? 1 : 0));
    }
    for (let k = 0; k < 2; k++) extras.push((this.fires[k]?.tick || 0) / 0.1);
    for (const value of extras) push(value);
    if (i !== OBS_SIZE) throw new Error('Incomplete observation: ' + i + '/' + OBS_SIZE);
    this.obsFilled = i;
    return obs;
  }

  /* ------------------------------------------------------------------ */
  /*  Control                                                            */
  /* ------------------------------------------------------------------ */
  setControl(control) {
    this.control = control;
  }

  autoAim() {
    const a = this.agent;
    let best = null, bestD = WEAPONS[a.weapon].range ** 2;
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      const d = (z.x - a.x) ** 2 + (z.z - a.z) ** 2;
      if (d < bestD) { bestD = d; best = z; }
    }
    if (!best) return null;
    return Math.atan2(best.x - a.x, best.z - a.z);
  }

  step(moveIdx, combatIdx, opts = {}) {
    if (this.done) return { obs: this.getObservation(), reward: 0, done: true, info: this.info() };
    const potential = this.resourcePotential();
    this.stepCount += 1;
    this.pendingReward = 0;
    const [mx, mz] = MOVE_DIRS[typeof moveIdx === 'object' ? moveIdx.move : moveIdx] || [0, 0];

    const control = {
      mx, mz,
      aim: opts.manualAim ?? null,
      fire: combatIdx === COMBAT.FIRE,
      cycle: combatIdx === COMBAT.CYCLE,
      buildTurret: combatIdx === COMBAT.TURRET,
      throwMolotov: combatIdx === COMBAT.MOLOTOV,
      dash: combatIdx === COMBAT.DASH,
      medkit: combatIdx === COMBAT.MEDKIT,
      reload: combatIdx === COMBAT.RELOAD,
    };
    this.setControl(typeof moveIdx === 'object' ? tacticalControl(moveIdx) : control);

    const sub = 4;
    const subDt = 0.2 / sub;
    for (let i = 0; i < sub && !this.done; i++) this.tick(subDt);
    const nextPotential = this.done && !this.truncated ? 0 : this.resourcePotential();
    this.addReward('resource', CFG.gamma * nextPotential - potential);
    const reward = this.pendingReward;
    this.pendingReward = 0;
    this.episodeReward += reward;
    return {
      obs: this.getObservation(),
      reward,
      done: this.done,
      truncated: this.truncated,
      info: this.info(),
    };
  }

  resourcePotential() {
    const a = this.agent;
    let ammo = 0;
    for (let k = 0; k < WEAPONS.length; k++) {
      if (a.weapons[k].owned && WEAPONS[k].mag !== Infinity) ammo += a.weapons[k].mag + a.weapons[k].reserve;
    }
    return 0.5 * a.scrap / 999 + 0.01 * ammo + 0.15 * (a.medkits + a.bombs);
  }

  info() {
    return {
      kills: this.episodeKills,
      waveKills: this.waveKills,
      wave: this.wave,
      quota: this.waveQuota,
      spawned: this.waveSpawned,
      remaining: this.zombies.length,
      wavesCleared: this.wavesCleared,
      time: this.time,
      hp: this.agent.hp,
      houseHp: this.houseHp,
      scrap: this.agent.scrap,
      outcome: this.outcome,
      truncated: this.truncated,
      gear: this.gearInfo(),
      rewardPieces: { ...this.rewardParts },
    };
  }

  gearInfo() {
    const a = this.agent;
    const w = WEAPONS[a.weapon];
    const ws = a.weapons[a.weapon];
    return {
      weapon: w.id,
      name: w.name,
      mag: ws.mag,
      reserve: ws.reserve,
      reloading: ws.reloadT > 0,
      bombs: a.bombs,
      medkits: a.medkits,
      perks: PERKS.filter((p) => a.perks[p]),
    };
  }

  /* Advance in real time (renderer / manual play). */
  advance(dt, control) {
    if (this.done) return;
    this.setControl(control);
    this.tick(clamp(dt, 0.001, 0.06));
  }

  /* ------------------------------------------------------------------ */
  /*  Simulation tick                                                    */
  /* ------------------------------------------------------------------ */
  tick(dt) {
    if (this.done) return;
    const a = this.agent;
    this.time += dt;
    const c = this.control || { mx: 0, mz: 0 };

    // This wave's horde: spawn until the quota is spent (bounded field size).
    if (this.zombies.length < CFG.maxZombies) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.waveSpawned < this.waveQuota) {
        this.spawnZombie();
        this.waveSpawned += 1;
        this.spawnTimer = Math.max(0.35, CFG.spawnInterval - this.wave * 0.045) * (0.85 + this.rng() * 0.5);
      }
    }

    // crates
    if (this.crates.length < CFG.maxCrates && this.rng() < dt / CFG.crateInterval) {
      this.spawnCrate(false);
    }

    // gear drops: ammo, weapons, medkits, firebombs, perks
    if (this.pickups.length < CFG.maxPickups) {
      this.pickupTimer -= dt;
      if (this.pickupTimer <= 0) {
        this.spawnPickup();
        this.pickupTimer = CFG.pickupInterval * (0.8 + this.rng() * 0.6);
      }
    }

    // aim
    const desired = c.aim ?? this.autoAim();
    if (desired != null) {
      const d = angleDelta(a.aim, desired);
      a.aim += clamp(d, -dt * 16, dt * 16);
    }

    // movement
    let speed = CFG.agentSpeed * a.speedMul;
    if (a.dashT > 0) {
      speed = CFG.dashSpeed;
      a.dashT -= dt;
    }
    let mx = c.mx || 0, mz = c.mz || 0;
    if (a.dashT > 0 && Math.abs(mx) + Math.abs(mz) < 0.1) {
      mx = Math.sin(a.aim);
      mz = Math.cos(a.aim);
    }
    const mlen = Math.hypot(mx, mz);
    if (mlen > 0.01) {
      mx /= mlen; mz /= mlen;
      a.x += mx * speed * dt;
      a.z += mz * speed * dt;
      a.regenT = 0;
    } else {
      a.regenT += dt;
    }
    a.x = clamp(a.x, -CFG.arenaHalf, CFG.arenaHalf);
    a.z = clamp(a.z, -CFG.arenaHalf, CFG.arenaHalf);
    this.resolveHouseCollision(a);

    // cooldowns and the reloading clock
    for (let k = 0; k < a.weapons.length; k++) {
      const ws = a.weapons[k];
      const w = WEAPONS[k];
      ws.cd = Math.max(0, ws.cd - dt);
      if (ws.reloadT > 0) {
        ws.reloadT -= dt;
        if (ws.reloadT <= 0) {
          ws.reloadT = 0;
          if (w.mag !== Infinity) {
            const want = Math.min(w.mag - ws.mag, ws.reserve);
            ws.mag += want;
            ws.reserve -= want;
            this.emit({ type: 'reloadDone', weapon: w.id });
          }
        }
      }
    }
    a.swapCd = Math.max(0, a.swapCd - dt);
    a.medCd = Math.max(0, a.medCd - dt);
    a.molotovCd = Math.max(0, a.molotovCd - dt);
    a.dashCd = Math.max(0, a.dashCd - dt);
    a.hurtT = Math.max(0, a.hurtT - dt);
    a.invuln = Math.max(0, a.invuln - dt);

    // regen
    a.lastHurt += dt;
    if (a.regenT > 3.5 && a.hp < a.maxHp) {
      a.hp = Math.min(a.maxHp, a.hp + 2.2 * dt);
    }

    // weapons
    if (c.weapon != null) this.selectWeapon(c.weapon);
    if (c.fire) this.fireWeapon();
    if (c.cycle) this.cycleWeapon();
    if (c.reload) this.startReload();
    if (c.medkit) this.useMedkit();
    if (c.buildTurret) this.buildTurret();
    if (c.throwMolotov) this.throwMolotov();
    if (c.dash && a.dashCd <= 0) {
      a.dashCd = CFG.dashCd;
      a.dashT = CFG.dashTime;
      this.emit({ type: 'dash', x: a.x, z: a.z });
    }

    // active fires
    for (const f of this.fires) {
      f.t -= dt;
      f.tick = (f.tick || 0) + dt;
      while (f.tick >= 0.1 - 1e-9) {
        f.tick = Math.max(0, f.tick - 0.1);
        for (const z of this.zombies) {
          if (z.hp > 0 && len2(z.x - f.x, z.z - f.z) < f.r + z.radius) {
            this.damageZombie(z, CFG.fireDps * 0.1, 'fire', false);
          }
        }
      }
      if (this.rng() < dt * 9) {
        const ang = this.rng() * 6.283, rr = Math.sqrt(this.rng()) * f.r;
        this.emit({ type: 'fire', x: f.x + Math.cos(ang) * rr, z: f.z + Math.sin(ang) * rr });
      }
      // scorch tick
    }
    this.fires = this.fires.filter((f) => f.t > 0);

    // turrets
    for (const t of this.turrets) {
      t.cd = Math.max(0, t.cd - dt);
      let best = null, bestD = CFG.turretRange * CFG.turretRange;
      for (const z of this.zombies) {
        if (z.hp <= 0) continue;
        const d = (z.x - t.x) ** 2 + (z.z - t.z) ** 2;
        if (d < bestD) { bestD = d; best = z; }
      }
      if (best) {
        t.angle = Math.atan2(best.x - t.x, best.z - t.z);
        if (t.cd <= 0) {
          t.cd = CFG.turretCd;
          const dmg = CFG.turretDamage;
          this.damageZombie(best, dmg, 'turret', true);
          this.emit({ type: 'turretShot', x: t.x, z: t.z, tx: best.x, tz: best.z });
        }
      }
    }
    this.turrets = this.turrets.filter((t) => t.hp > 0);

    // zombies
    this.updateZombies(dt);

    // crates pickup
    for (const crate of this.crates) {
      if (!crate.active) continue;
      if (len2(crate.x - a.x, crate.z - a.z) < 1.5) {
        crate.active = false;
        const salvage = Math.min(999 - a.scrap, crate.value * a.salvageMul);
        a.scrap = Math.min(999, a.scrap + salvage);
        this.scrapCollected += salvage;
        this.addReward('scrap', CFG.reward.scrap * 2 * salvage / CFG.crateValue);
        this.emit({ type: 'crate', x: crate.x, z: crate.z, amount: Math.round(salvage) });
      }
    }
    this.crates = this.crates.filter((c) => c.active);

    // gear pickups
    for (const p of this.pickups) {
      if (!p.active) continue;
      if (len2(p.x - a.x, p.z - a.z) < CFG.pickupRadius) this.collectPickup(p);
    }
    this.pickups = this.pickups.filter((p) => p.active);

    // survival reward
    this.addReward('survival', CFG.reward.survival * dt);

    // Terminal conditions. An episode is the whole defence, so it ends only
    // when Mara or the house falls. A cleared wave simply escalates the horde
    // inside the same episode.
    if (this.houseHp <= 0) {
      this.finish('house');
    } else if (a.hp <= 0) {
      this.finish('dead');
    } else if (this.waveSpawned >= this.waveQuota && this.zombies.length === 0) {
      // Wave held: credit it, then the next, larger horde walks in.
      this.wavesCleared += 1;
      const heldWave = this.wave;
      const houseFrac = clamp(this.houseHp / CFG.houseMaxHp, 0, 1);
      const vitalFrac = clamp(a.hp / a.maxHp, 0, 1);
      const held = CFG.reward.waveClear * (1 + heldWave * 0.12)
        + houseFrac * CFG.reward.integrity
        + vitalFrac * CFG.reward.vitality;
      this.addReward('wave', held);
      this.emit({
        type: 'waveClear',
        wave: heldWave,
        kills: this.waveKills,
        houseHp: this.houseHp,
        hp: a.hp,
        wavesCleared: this.wavesCleared,
      });

      this.wave += 1;
      this.waveQuota = waveQuota(this.wave);
      this.waveSpawned = 0;
      this.waveKills = 0;
      this.waveKilled = 0;
      this.spawnTimer = CFG.waveRest;
      this.emit({ type: 'wave', wave: this.wave, quota: this.waveQuota });
    }

    // Safety cap: a defence that never breaks is truncated so the value
    // function can bootstrap, not terminated as a failure. This runs in the
    // tick loop, so the training stepper and the visible run share the cap.
    if (!this.done && this.time >= CFG.maxEpisodeTime) {
      this.truncated = true;
      this.done = true;
      this.emit({
        type: 'end', outcome: null, wave: this.wave,
        wavesCleared: this.wavesCleared, truncated: true,
      });
    }
  }

  addReward(kind, amount) {
    this.pendingReward += amount;
    if (this.rewardParts[kind] !== undefined) this.rewardParts[kind] += amount;
    else this.rewardParts.bonus = (this.rewardParts.bonus || 0) + amount;
  }

  finish(outcome) {
    if (this.done) return;
    this.done = true;
    this.truncated = false;
    this.outcome = outcome;
    if (outcome === 'house') this.addReward('bonus', CFG.reward.houseLost);
    if (outcome === 'dead') this.addReward('bonus', CFG.reward.death);
    this.emit({ type: 'end', outcome, wave: this.wave, wavesCleared: this.wavesCleared });
  }

  /* ------------------------------------------------------------------ */
  /*  Weapons                                                            */
  /* ------------------------------------------------------------------ */
  rayTarget(range, maxAngle = 0.16) {
    const a = this.agent;
    let best = null, bestDist = range;
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      const dx = z.x - a.x, dz = z.z - a.z;
      const dist = len2(dx, dz);
      if (dist > range) continue;
      const ang = Math.atan2(dx, dz);
      const diff = Math.abs(angleDelta(a.aim, ang));
      if (diff > maxAngle + z.radius / Math.max(2, dist)) continue;
      if (dist < bestDist) { bestDist = dist; best = z; }
    }
    return best;
  }

  fireWeapon() {
    const a = this.agent;
    const w = WEAPONS[a.weapon];
    const ws = a.weapons[a.weapon];
    if (!ws.owned || ws.reloadT > 0 || ws.cd > 0) return;
    if (ws.mag <= 0) {
      if (ws.reserve > 0) this.startReload();
      else this.emit({ type: 'dry', weapon: w.id });
      return;
    }
    ws.cd = w.cd * a.cdMul;
    if (ws.mag !== Infinity) ws.mag -= 1;
    if (w.shot === 'shotgun') this.fireSpread(w);
    else this.fireSingle(w);
  }

  fireSingle(w) {
    const a = this.agent;
    const target = this.rayTarget(w.range, w.cone);
    const tx = a.x + Math.sin(a.aim) * (target ? 5 : w.range);
    const tz = a.z + Math.cos(a.aim) * (target ? 5 : w.range);
    this.emit({ type: 'shot', x: a.x, z: a.z, tx: target ? target.x : tx, tz: target ? target.z : tz, hit: !!target, kind: w.shot });
    if (target) this.damageZombie(target, w.dmg, w.shot, true);
  }

  fireSpread(w) {
    const a = this.agent;
    let hitCount = 0;
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      const dx = z.x - a.x, dz = z.z - a.z;
      if (len2(dx, dz) > w.range) continue;
      if (Math.abs(angleDelta(a.aim, Math.atan2(dx, dz))) < w.cone) {
        this.damageZombie(z, w.dmg, w.shot, true);
        hitCount++;
      }
    }
    const tx = a.x + Math.sin(a.aim) * w.range;
    const tz = a.z + Math.cos(a.aim) * w.range;
    this.emit({ type: 'shot', x: a.x, z: a.z, tx, tz, hit: hitCount > 0, kind: w.shot });
  }

  cycleWeapon() {
    const a = this.agent;
    if (a.swapCd > 0) return;
    a.swapCd = CFG.swapCd;
    const start = a.weapon;
    for (let k = 1; k <= WEAPONS.length; k++) {
      const idx = (start + k) % WEAPONS.length;
      if (a.weapons[idx].owned) {
        a.weapon = idx;
        this.emit({ type: 'swap', weapon: WEAPONS[idx].id });
        return;
      }
    }
  }

  selectWeapon(index) {
    const a = this.agent;
    if (!Number.isInteger(index) || !a.weapons[index]?.owned || a.weapon === index || a.swapCd > 0) return;
    a.weapon = index;
    a.swapCd = CFG.swapCd;
    this.emit({ type: 'swap', weapon: WEAPONS[index].id });
  }

  startReload() {
    const a = this.agent;
    const w = WEAPONS[a.weapon];
    const ws = a.weapons[a.weapon];
    if (w.mag === Infinity || ws.reloadT > 0) return;
    if (ws.mag >= w.mag || ws.reserve <= 0) return;
    ws.reloadT = w.reload * a.reloadMul;
    this.emit({ type: 'reload', weapon: w.id, reserve: ws.reserve });
  }

  useMedkit() {
    const a = this.agent;
    if (a.medkits <= 0 || a.medCd > 0 || a.hp >= a.maxHp) return;
    a.medkits -= 1;
    a.medCd = 1.0;
    const healed = Math.min(CFG.medkitHeal, a.maxHp - a.hp);
    a.hp += healed;
    a.regenT = 0;
    a.lastHurt = 0;
    this.addReward('gear', CFG.reward.usedMedkit);
    this.emit({ type: 'medkit', x: a.x, z: a.z, healed });
  }

  buildTurret() {
    const a = this.agent;
    if (a.scrap < CFG.turretCost) return;
    if (this.turrets.length >= CFG.maxTurrets) return;
    if (this.time - (this.lastTurretTime ?? -Infinity) < 0.7) return;
    this.lastTurretTime = this.time;
    a.scrap -= CFG.turretCost;
    const tx = clamp(a.x + Math.sin(a.aim) * 1.5, -28, 28);
    const tz = clamp(a.z + Math.cos(a.aim) * 1.5, -28, 28);
    this.turrets.push({ id: this.nextId++, x: tx, z: tz, hp: CFG.turretHp, maxHp: CFG.turretHp, cd: 0, angle: a.aim });
    this.addReward('gear', CFG.reward.turretBuilt);
    this.emit({ type: 'build', x: tx, z: tz });
  }

  throwMolotov() {
    const a = this.agent;
    if (a.molotovCd > 0) return;
    if (a.bombs > 0) {
      a.bombs -= 1;
    } else if (a.scrap >= CFG.molotovCost) {
      a.scrap -= CFG.molotovCost;
    } else return;
    a.molotovCd = CFG.molotovCd;
    const tx = clamp(a.x + Math.sin(a.aim) * CFG.molotovRange, -29, 29);
    const tz = clamp(a.z + Math.cos(a.aim) * CFG.molotovRange, -29, 29);
    this.fires.push({ id: this.nextId++, x: tx, z: tz, r: CFG.fireRadius, t: CFG.fireDur, tick: 0 });
    this.addReward('gear', CFG.reward.molotovThrown);
    this.emit({ type: 'molotov', x: a.x, z: a.z, tx, tz, fromStock: true });
  }

  /* ------------------------------------------------------------------ */
  /*  Damage                                                             */
  /* ------------------------------------------------------------------ */
  damageZombie(z, amount, source, showNumber) {
    if (z.hp <= 0) return;
    const dealt = Math.min(amount, z.hp);
    z.hp -= amount;
    this.damageDealt += dealt;
    this.addReward('damage', dealt * CFG.reward.damage);
    z.flash = 0.1;
    if (showNumber) this.emit({ type: 'hit', x: z.x, z: z.z, kind: source });
    if (z.hp <= 0) {
      this.episodeKills += 1;
      this.waveKills += 1;
      this.waveKilled = Math.min(this.waveQuota, this.waveKilled + 1);
      const scrapGain = Math.min(999 - this.agent.scrap, z.scrap * this.agent.salvageMul);
      this.agent.scrap = Math.min(999, this.agent.scrap + scrapGain);
      this.scrapCollected += scrapGain;
      this.addReward('kill', CFG.reward.kills[z.type] || 4);
      this.emit({ type: 'kill', x: z.x, z: z.z, type: z.type, id: z.id });
      this.lastKill = { type: z.type, x: z.x, z: z.z, t: this.time };
    }
  }

  damageAgent(amount, z) {
    const a = this.agent;
    if (a.invuln > 0) return;
    a.hp -= amount;
    a.invuln = 0.3;
    a.hurtT = 0.2;
    a.lastHurt = 0;
    a.regenT = 0;
    this.agentDamageTaken += amount;
    this.addReward('hurt', CFG.reward.agentHurt * amount);
    this.emit({ type: 'hurtAgent', x: a.x, z: a.z, amount });
    if (a.hp <= 0) {
      a.hp = 0;
      this.finish('dead');
    }
  }

  damageHouse(amount, z) {
    this.houseHp -= amount;
    this.houseDamageTaken += amount;
    this.addReward('house', CFG.reward.houseHurt * amount);
    this.emit({ type: 'houseHit', x: z ? z.x : 0, z: z ? z.z : -15, amount });
    if (this.houseHp <= 0) {
      this.houseHp = 0;
      this.finish('house');
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Zombies                                                            */
  /* ------------------------------------------------------------------ */
  spawnZombie() {
    const rnd = this.rng;
    const spots = [
      [0, 31], [8, 31], [-8, 31], [27, 26], [-27, 24], [31, 8], [-31, 6], [30, -8], [-30, -12],
    ];
    let sx, sz, tries = 0;
    do {
      const spot = spots[(rnd() * spots.length) | 0];
      sx = spot[0] + (rnd() - 0.5) * 6;
      sz = spot[1] + (rnd() - 0.5) * 5;
      tries++;
    } while (len2(sx - this.agent.x, sz - this.agent.z) < 16 && tries < 10);
    sx = clamp(sx, -31, 31);
    sz = clamp(sz, -31, 31);

    const roll = rnd();
    let type = 'walker';
    if (this.wave >= 2 && roll < 0.30) type = 'runner';
    if (this.wave >= 3 && roll > 0.86) type = 'brute';
    if (this.wave >= 6 && roll > 0.74) type = 'brute';

    const def = ZOMBIE_TYPES[type];
    const w = this.wave;
    const hpScale = 1 + Math.min(2.1, (w - 1) * 0.10);
    const speedScale = 1 + Math.min(0.5, (w - 1) * 0.03);
    const dmgScale = 1 + Math.min(0.85, (w - 1) * 0.05);
    const z = {
      id: this.nextId++,
      x: sx, z: sz,
      hp: def.hp * hpScale,
      maxHp: def.hp * hpScale,
      speed: def.speed * speedScale,
      dmg: def.dmg * dmgScale,
      type,
      typeIndex: type === 'walker' ? 0 : type === 'runner' ? 1 : 2,
      radius: def.radius,
      scrap: def.scrap,
      attackCd: 0.5 + rnd() * 0.5,
      aggro: false,
      wander: rnd() * 6.28,
      flash: 0,
      variant: (rnd() * 1000) | 0,
    };
    this.zombies.push(z);
    this.emit({ type: 'spawn', x: sx, z: sz, kind: type, id: z.id });
  }

  updateZombies(dt) {
    const a = this.agent;
    const alive = [];
    for (const z of this.zombies) {
      if (z.hp <= 0) continue;
      z.attackCd = Math.max(0, z.attackCd - dt);
      z.flash = Math.max(0, z.flash - dt);

      const da = len2(z.x - a.x, z.z - a.z);
      z.aggro = da < 7.5 || (z.aggro && da < 12);
      let tx, tz, targetKind = 'house';

      // close turret?
      let turret = null, td = 6.5;
      for (const t of this.turrets) {
        const d = len2(z.x - t.x, z.z - t.z);
        if (d < td) { td = d; turret = t; }
      }

      if (da < 7.5) {
        targetKind = 'agent';
        tx = a.x; tz = a.z;
      } else if (turret && td < 4.5) {
        targetKind = 'turret';
        tx = turret.x; tz = turret.z;
      } else if (z.z > -9.2) {
        const spread = ((z.id * 37) % 9 - 4) * 0.45;
        tx = spread; tz = -9.6;
        targetKind = 'gate';
      } else {
        tx = CFG.doorX + ((z.id * 53) % 7 - 3) * 0.28;
        tz = CFG.doorZ;
      }

      let dx = tx - z.x, dz = tz - z.z;
      let dl = Math.hypot(dx, dz);
      if (dl > 0.001) {
        dx /= dl; dz /= dl;
      }

      // separation
      let sx = 0, sz = 0;
      for (const o of this.zombies) {
        if (o === z || o.hp <= 0) continue;
        const ox = z.x - o.x, oz = z.z - o.z;
        const d2 = ox * ox + oz * oz;
        const minD = (z.radius + o.radius) * 1.15;
        if (d2 > 0.0001 && d2 < minD * minD) {
          const d = Math.sqrt(d2);
          sx += (ox / d) * (minD - d);
          sz += (oz / d) * (minD - d);
        }
      }

      const speed = z.speed * (targetKind === 'agent' && da < 4 ? 1.1 : 1);
      z.x += (dx + sx * 1.7) * speed * dt;
      z.z += (dz + sz * 1.7) * speed * dt;
      z.x = clamp(z.x, -31, 31);
      z.z = clamp(z.z, -31, 31);
      this.resolveHouseCollision(z);

      // attacks
      if (targetKind === 'agent' && da < 1.1) {
        if (z.attackCd <= 0) {
          z.attackCd = 0.95;
          this.damageAgent(z.dmg, z);
        }
      } else if (targetKind === 'turret' && turret && td < 1.35) {
        if (z.attackCd <= 0) {
          z.attackCd = 1.0;
          turret.hp -= z.dmg * 0.6;
          this.emit({ type: 'turretHit', x: turret.x, z: turret.z });
        }
      } else if (z.z < -11.2 && len2(z.x - CFG.doorX, z.z - CFG.doorZ) < 2.6) {
        if (z.attackCd <= 0) {
          z.attackCd = 1.15;
          this.damageHouse(z.dmg * 0.55, z);
        }
      }

      alive.push(z);
    }
    this.zombies = alive;
  }

  resolveHouseCollision(ent) {
    const r = ent.radius || 0.5;
    if (ent.x > HOUSE_RECT.x0 - r && ent.x < HOUSE_RECT.x1 + r && ent.z > HOUSE_RECT.z0 - r && ent.z < HOUSE_RECT.z1 + r) {
      const dl = Math.abs(ent.x - (HOUSE_RECT.x0 - r));
      const dr = Math.abs(HOUSE_RECT.x1 + r - ent.x);
      const df = Math.abs(HOUSE_RECT.z1 + r - ent.z);
      const mn = Math.min(dl, dr, df);
      if (mn === dl) ent.x = HOUSE_RECT.x0 - r;
      else if (mn === dr) ent.x = HOUSE_RECT.x1 + r;
      else ent.z = HOUSE_RECT.z1 + r;
    }
  }

  spawnCrate(initial) {
    const rnd = this.rng;
    for (let i = 0; i < 20; i++) {
      const x = (rnd() - 0.5) * 48;
      const z = initial ? -5 + rnd() * 30 : -8 + rnd() * 34;
      if (x > -8 && x < 8 && z < -14) continue;
      if (this.crates.some((c) => len2(c.x - x, c.z - z) < 5)) continue;
      if (len2(x - this.agent.x, z - this.agent.z) < 5) continue;
      this.crates.push({ id: this.nextId++, x, z, active: true, value: CFG.crateValue });
      return;
    }
    this.crates.push({ id: this.nextId++, x: -10, z: 15, active: true, value: CFG.crateValue });
  }

  /* ------------------------------------------------------------------ */
  /*  Gear drops                                                         */
  /* ------------------------------------------------------------------ */
  spawnPickup() {
    const rnd = this.rng;
    const a = this.agent;
    const rifle = a.weapons[WEAPONS.findIndex((w) => w.id === 'rifle')];
    const roll = rnd();

    let kind;
    if (!rifle.owned && roll < 0.42) kind = 'weapon';
    else if (a.perkCount < PERKS.length && roll < 0.66) kind = 'perk';
    else if (roll < 0.82) kind = 'medkit';
    else if (roll < 0.93) kind = 'bomb';
    else kind = 'ammo';

    let payload = null;
    if (kind === 'weapon') payload = 'rifle';
    else if (kind === 'perk') {
      const left = PERKS.filter((p) => !a.perks[p]);
      payload = left[(rnd() * left.length) | 0];
    }

    for (let i = 0; i < 20; i++) {
      // gear tends to land close to cover: beside a crate when one exists
      const crate = this.crates[(rnd() * this.crates.length) | 0];
      const near = crate && rnd() < 0.5;
      const x = near ? crate.x + (rnd() - 0.5) * 7 : (rnd() - 0.5) * 46;
      const z = near ? crate.z + (rnd() - 0.5) * 7 : -10 + rnd() * 34;
      if (x < -28 || x > 28 || z < -12 || z > 28) continue;
      if (x > -8 && x < 8 && z < -14) continue;
      if (this.pickups.some((p) => p.active && len2(p.x - x, p.z - z) < 6)) continue;
      if (len2(x - a.x, z - a.z) < 5) continue;
      this.pickups.push({ id: this.nextId++, x, z, kind, payload, active: true });
      this.emit({ type: 'pickupSpawn', x, z, kind });
      return;
    }
    this.pickups.push({
      id: this.nextId++, x: 12, z: 18, kind, payload, active: true,
    });
    this.emit({ type: 'pickupSpawn', x: 12, z: 18, kind });
  }

  collectPickup(p) {
    const a = this.agent;
    p.active = false;
    switch (p.kind) {
      case 'ammo': {
        const slot = a.weapons[a.weapon];
        const w = WEAPONS[a.weapon];
        if (w.reserve === Infinity) {
          // the sidearm never needs cartridges; top up the emptiest slot instead
          let k = a.weapon;
          let low = Infinity;
          for (let i = 0; i < a.weapons.length; i++) {
            if (WEAPONS[i].reserve === Infinity || !a.weapons[i].owned) continue;
            if (a.weapons[i].reserve < low) { low = a.weapons[i].reserve; k = i; }
          }
          if (WEAPONS[k].reserve === Infinity) break;
          a.weapons[k].reserve = Math.min(CFG.reserveCap, a.weapons[k].reserve + CFG.ammoBox);
          this.emit({ type: 'pickup', kind: 'ammo', x: p.x, z: p.z, label: `+${CFG.ammoBox} ${WEAPONS[k].name} SHELLS` });
        } else {
          slot.reserve = Math.min(CFG.reserveCap, slot.reserve + CFG.ammoBox);
          this.emit({ type: 'pickup', kind: 'ammo', x: p.x, z: p.z, label: `+${CFG.ammoBox} ${w.name} SHELLS` });
        }
        break;
      }
      case 'weapon': {
        const idx = WEAPONS.findIndex((w) => w.id === p.payload);
        if (idx < 0 || a.weapons[idx].owned) {
          // already found: the drop degrades into spare ammunition
          let k = a.weapon;
          let low = Infinity;
          for (let i = 0; i < a.weapons.length; i++) {
            if (WEAPONS[i].reserve === Infinity || !a.weapons[i].owned) continue;
            if (a.weapons[i].reserve < low) { low = a.weapons[i].reserve; k = i; }
          }
          a.weapons[k].reserve = Math.min(CFG.reserveCap, a.weapons[k].reserve + CFG.ammoBox);
            this.emit({ type: 'pickup', kind: 'ammo', x: p.x, z: p.z, label: `+${CFG.ammoBox} ${WEAPONS[k].name} SHELLS` });
          break;
        }
        a.weapons[idx].owned = true;
        a.weapons[idx].mag = WEAPONS[idx].mag;
        a.weapons[idx].reserve = WEAPONS[idx].reserve;
        a.weapon = idx;
        a.swapCd = CFG.swapCd;
        this.addReward('gear', CFG.reward.foundWeapon);
        this.emit({ type: 'pickup', kind: 'weapon', x: p.x, z: p.z, label: `${WEAPONS[idx].name} ACQUIRED` });
        break;
      }
      case 'medkit': {
        if (a.medkits < CFG.medkitMax) { a.medkits += 1; }
        else { a.hp = Math.min(a.maxHp, a.hp + CFG.medkitHeal); }
        this.emit({ type: 'pickup', kind: 'medkit', x: p.x, z: p.z, label: '+1 MEDKIT' });
        break;
      }
      case 'bomb': {
        if (a.bombs < CFG.bombMax) { a.bombs += 1; }
        else { a.scrap = Math.min(999, a.scrap + CFG.molotovCost); }
        this.emit({ type: 'pickup', kind: 'bomb', x: p.x, z: p.z, label: '+1 FIREBOMB' });
        break;
      }
      case 'perk': {
        if (a.perks[p.payload]) break;
        a.perks[p.payload] = true;
        a.perkCount += 1;
        if (p.payload === 'vigor') {
          a.maxHp += 25;
          a.hp = Math.min(a.maxHp, a.hp + 25);
        } else if (p.payload === 'swift') {
          a.speedMul = 1.18;
        } else if (p.payload === 'steady') {
          a.cdMul = 0.78;
          a.reloadMul = 0.75;
        } else if (p.payload === 'scavenger') {
          a.salvageMul = 1.6;
        }
        this.addReward('gear', CFG.reward.foundPerk);
        this.emit({
          type: 'pickup', kind: 'perk', perk: p.payload, x: p.x, z: p.z,
          label: PERK_NAMES[p.payload].toUpperCase(),
        });
        break;
      }
      default:
        break;
    }
  }

  clearEvents() {
    const out = this.eventsBuf;
    this.eventsBuf = [];
    return out;
  }
}

export { HOUSE_RECT, ZOMBIE_TYPES };
