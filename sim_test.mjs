/* Headless checks for the weapon inventory, gear drops and episode semantics. */

import {
  Env, CFG, COMBAT, WEAPONS, PERKS, waveQuota,
  OBS_SIZE, OBS_SELF, OBS_INVENTORY, OBS_ZOMBIE_SLOTS, OBS_ZOMBIE_FIELDS, OBS_HORDE,
} from './src/sim/env.js';

let fails = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    console.log(`  pass  ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fails += 1;
    console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const env = new Env({ seed: 1234, events: true });

/* --- observation ---------------------------------------------------- */
let obs = env.reset(7, { immediate: true });
ok('observation length', obs.length === OBS_SIZE, `${obs.length} slots`);
ok('observation finite', obs.every((v) => Number.isFinite(v)));
ok('observation in range', obs.every((v) => v >= -1.6 && v <= 1.6));
ok('observation layout fills every slot', env.obsFilled === OBS_SIZE, `${env.obsFilled} of ${OBS_SIZE}`);

/* --- inventory fields in the state ------------------------------------ */
const INV0 = OBS_SELF;
const invSlot = (k) => INV0 + k * 4;
ok('per-slot inventory is readable',
  obs[invSlot(0)] === 1 && obs[invSlot(1)] === 1 && obs[invSlot(2)] === 0,
  `sidearm ${obs[invSlot(0)]}, shotgun ${obs[invSlot(1)]}, rifle ${obs[invSlot(2)]}`);
ok('ammo and cooldown fields are readable',
  Math.abs(obs[invSlot(1) + 1] - 1) < 1e-4 && Math.abs(obs[invSlot(1) + 2] - 26 / CFG.reserveCap) < 1e-4,
  `shotgun mag ${obs[invSlot(1) + 1]}, reserve ${obs[invSlot(1) + 2].toFixed(2)}`);
const EQUIP = INV0 + WEAPONS.length * 4 + 2;
ok('equipped weapon one-hot', obs[EQUIP] === 1 && obs[EQUIP + 1] === 0 && obs[EQUIP + 2] === 0);

/* --- sight coverage --------------------------------------------------- */
const Z0 = OBS_SELF + OBS_INVENTORY;
const zSlot = (k) => Z0 + k * OBS_ZOMBIE_FIELDS;
const HORDE = Z0 + OBS_ZOMBIE_SLOTS * OBS_ZOMBIE_FIELDS;
const HOUSE = HORDE + OBS_HORDE;
const near = (v, target) => Math.abs(v - target) < 1e-4;
ok('one slot per soul the field can hold at once', OBS_ZOMBIE_SLOTS === CFG.maxZombies,
  `${OBS_ZOMBIE_SLOTS} slots`);

env.reset(7, { immediate: true });
const a = env.agent;

// a soul due east, well inside sight
env.zombies = [{ x: a.x + 10, z: a.z, hp: 32, speed: 1.35, typeIndex: 0, attackCd: 0.4, aggro: true }];
obs = env.getObservation();
const s0 = zSlot(0);
ok('distance to a soul is in the state', near(obs[s0 + 1], 10 / CFG.arenaHalf), `slot reads ${obs[s0 + 1].toFixed(3)}`);
ok('bearing to a soul is in the state', obs[s0 + 2] === 1 && obs[s0 + 3] === 0);
ok('the sight flag marks a soul in view', obs[s0] === 1);
ok('soul vitals travel with it',
  near(obs[s0 + 4], 32 / CFG.zombieMaxHp) && obs[s0 + 8] === 1, `hp ${obs[s0 + 4].toFixed(3)}`);
ok('the horde counts what is in sight',
  near(obs[HORDE], 1 / CFG.maxZombies) && near(obs[HORDE + 1], 1 / CFG.maxZombies));

// a soul beyond sight: its slot says "out of view", but distance and bearing stay
env.zombies = [{ x: a.x + 40, z: a.z - 20, hp: 100, speed: 1, typeIndex: 2, attackCd: 0, aggro: false }];
obs = env.getObservation();
const farD = Math.hypot(40, 20);
ok('a soul outside sight flags itself as out of view', obs[zSlot(0)] === 0);
ok('a soul outside sight is still located',
  near(obs[zSlot(0) + 1], Math.min(1, farD / CFG.arenaHalf)) && near(obs[zSlot(0) + 2], 40 / farD),
  `dist ${obs[zSlot(0) + 1].toFixed(2)}, bearing x ${obs[zSlot(0) + 2].toFixed(2)}`);
ok('the horde count separates seen from unseen',
  near(obs[HORDE], 1 / CFG.maxZombies) && obs[HORDE + 1] === 0,
  `total ${obs[HORDE].toFixed(3)}, in sight ${obs[HORDE + 1].toFixed(3)}`);
ok('the pack bearing points at it',
  Math.abs(obs[HORDE + 2] - 40 / farD) < 1e-5 && Math.abs(obs[HORDE + 3] + 20 / farD) < 1e-5);

// a full field of souls: every one of them gets a slot
env.zombies = [];
for (let k = 0; k < CFG.maxZombies; k++) {
  const ang = (k / CFG.maxZombies) * Math.PI * 2;
  env.zombies.push({
    x: a.x + Math.cos(ang) * (6 + k), z: a.z + Math.sin(ang) * (6 + k),
    hp: 40, speed: 1.35, typeIndex: 0, attackCd: 0.5, aggro: true,
  });
}
obs = env.getObservation();
const lit = Array.from({ length: OBS_ZOMBIE_SLOTS }, (_, k) => obs[zSlot(k)]);
ok('every soul on the field gets its own slot', lit.every((v) => v === 1),
  `${lit.filter((v) => v === 1).length}/${OBS_ZOMBIE_SLOTS} slots lit`);
const dists = Array.from({ length: OBS_ZOMBIE_SLOTS }, (_, k) => obs[zSlot(k) + 1]);
ok('slots are ordered nearest first', dists.every((d, k) => k === 0 || d >= dists[k - 1]),
  `${dists[0].toFixed(2)} → ${dists[dists.length - 1].toFixed(2)}`);
ok('the horde totals match the field',
  near(obs[HORDE], 1) && obs[HORDE + 1] === 1,
  `total ${obs[HORDE].toFixed(3)}, in sight ${obs[HORDE + 1].toFixed(3)}`);

// the way back to the manor
env.zombies = [];
obs = env.getObservation();
const wayX = CFG.doorX - a.x, wayZ = CFG.houseZ - a.z;
const wayD = Math.hypot(wayX, wayZ);
ok('the way home is in the state',
  near(obs[HOUSE], Math.min(1, wayD / 30))
    && near(obs[HOUSE + 1], wayX / wayD)
    && near(obs[HOUSE + 2], wayZ / wayD),
  `${wayD.toFixed(1)} units out`);

/* --- starting inventory --------------------------------------------- */
ok('sidearm + shotgun owned', env.agent.weapons[0].owned && env.agent.weapons[1].owned);
ok('rifle not owned', !env.agent.weapons[2].owned);
ok('sidearm infinite magazine', env.agent.weapons[0].mag === Infinity);
ok('gear stock', env.agent.bombs === 2 && env.agent.medkits === 1);

/* --- firing consumes the magazine ----------------------------------- */
env.agent.weapon = 1;
const shellSlot = env.agent.weapons[1];
const reserve0 = shellSlot.reserve;
let shots = 0;
let emptied = false;
for (let i = 0; i < 160; i++) {
  const before = shellSlot.mag;
  env.step(0, COMBAT.FIRE);
  if (shellSlot.mag < before) shots += 1;
  if (shellSlot.mag === 0) emptied = true;
  if (env.done) break;
}
ok('shotgun fires until the magazine is dry', emptied && shots > 0, `${shots} shots`);

/* auto-reload from an empty magazine, deterministic */
env.reset(7, { immediate: true });
env.agent.weapon = 1;
const drySlot = env.agent.weapons[1];
drySlot.mag = 0;
drySlot.reserve = 10;
drySlot.cd = 0;
drySlot.reloadT = 0;
env.step(0, COMBAT.FIRE);
ok('dry magazine auto-reloads', drySlot.reloadT > 0, `reloadT ${drySlot.reloadT.toFixed(2)}`);
env.setControl({ mx: 0, mz: 0 });   // stop firing so the reload finishes clean
let ticks = 0;
while (drySlot.reloadT > 0 && ticks < 400) { env.tick(0.05); ticks += 1; }
ok('reload refills from reserve', drySlot.mag === WEAPONS[1].mag && drySlot.reserve === 2,
  `mag ${drySlot.mag}, reserve ${drySlot.reserve}`);

/* --- empty reserve goes dry ----------------------------------------- */
drySlot.mag = 0;
drySlot.reserve = 0;
drySlot.cd = 0;
drySlot.reloadT = 0;
env.clearEvents();
env.step(0, COMBAT.FIRE);
const evs = env.clearEvents();
ok('dry event when no reserve', evs.some((e) => e.type === 'dry'), evs.map((e) => e.type).join(','));

/* --- cycling only reaches owned weapons ----------------------------- */
env.agent.weapon = 0;
env.agent.swapCd = 0;
env.cycleWeapon();
ok('cycle reaches shotgun', env.agent.weapon === 1, WEAPONS[env.agent.weapon].id);
env.agent.swapCd = 0;
env.cycleWeapon();
ok('cycle skips unowned rifle', env.agent.weapon === 0, WEAPONS[env.agent.weapon].id);

/* --- medkit --------------------------------------------------------- */
env.agent.hp = 20;
env.agent.medCd = 0;
env.useMedkit();
ok('medkit heals', env.agent.hp === 20 + CFG.medkitHeal && env.agent.medkits === 0, `hp ${env.agent.hp}`);
env.agent.medCd = 0;
env.agent.hp = 20;
env.useMedkit();
ok('no medkit left, no heal', env.agent.hp === 20);

/* --- firebombs before scrap ----------------------------------------- */
env.agent.bombs = 1;
env.agent.scrap = 60;
env.agent.molotovCd = 0;
env.throwMolotov();
ok('bomb stock spent before scrap', env.agent.bombs === 0 && env.agent.scrap === 60);
env.agent.molotovCd = 0;
env.throwMolotov();
ok('scrap buys a bomb once stock is empty', env.agent.bombs === 0 && env.agent.scrap === 60 - CFG.molotovCost);

/* --- gear drops ----------------------------------------------------- */
env.reset(7, { immediate: true });
function grant(kind, payload = null) {
  env.pickups.push({ id: env.nextId++, x: env.agent.x, z: env.agent.z, kind, payload, active: true });
  env.tick(0.05);
  return env.pickups.filter((p) => p.active).length;
}

env.agent.weapon = 1;
env.agent.weapons[1].reserve = 4;
ok('ammo pickup tops reserve', grant('ammo') === 0 && env.agent.weapons[1].reserve === 4 + CFG.ammoBox);

env.agent.weapon = 0;
env.agent.weapons[2].reserve = 0;
grant('weapon', 'rifle');
ok('rifle pickup grants and equips', env.agent.weapons[2].owned && env.agent.weapon === 2);
ok('rifle arrives loaded', env.agent.weapons[2].mag === WEAPONS[2].mag && env.agent.weapons[2].reserve === WEAPONS[2].reserve);

env.agent.medkits = 0;
grant('medkit');
ok('medkit pickup stocked', env.agent.medkits === 1);
env.agent.bombs = 0;
grant('bomb');
ok('bomb pickup stocked', env.agent.bombs === 1);

env.agent.scrap = 0;
grant('perk', 'scavenger');
ok('scavenger perk applied', env.agent.perks.scavenger && env.agent.salvageMul === 1.6);
env.crates.push({ id: env.nextId++, x: env.agent.x, z: env.agent.z, active: true, value: CFG.crateValue });
env.tick(0.05);
ok('scavenger boosts salvage', Math.abs(env.agent.scrap - CFG.crateValue * 1.6) < 1e-6, `scrap ${env.agent.scrap}`);

grant('perk', 'swift');
ok('swift perk applied', env.agent.perkCount === 2 && env.agent.speedMul === 1.18);

/* --- spawn variety -------------------------------------------------- */
env.reset(99, { immediate: true });
const kinds = new Set();
for (let i = 0; i < 220; i++) {
  env.spawnPickup();
  for (const p of env.pickups) kinds.add(p.kind);
  env.pickups = [];
}
ok('all gear kinds can drop', kinds.size === 5, [...kinds].join(','));
ok('a rifle drop appears while it is unowned', kinds.has('weapon'));

env.agent.weapons[2].owned = true;
const ownedKinds = new Set();
for (let i = 0; i < 220; i++) {
  env.spawnPickup();
  for (const p of env.pickups) ownedKinds.add(p.kind);
  env.pickups = [];
}
ok('no rifle drop once it is owned', !ownedKinds.has('weapon'), [...ownedKinds].join(','));

/* --- explicit reload ------------------------------------------------ */
env.reset(5, { immediate: true });
env.agent.weapon = 2;
env.agent.weapons[2].owned = true;
env.agent.weapons[2].mag = 3;
env.agent.weapons[2].reserve = 20;
env.step(0, COMBAT.RELOAD);
ok('explicit reload starts', env.agent.weapons[2].reloadT > 0);
while (env.agent.weapons[2].reloadT > 0) env.tick(0.05);
ok('rifle reload completes', env.agent.weapons[2].mag === WEAPONS[2].mag, `mag ${env.agent.weapons[2].mag}`);

/* --- gear carries inside the episode -------------------------------- */
env.reset(11, { immediate: true });
env.agent.weapons[2].owned = true;
env.agent.perks.steady = true;
env.agent.perkCount = 1;
env.agent.cdMul = 0.78;
env.agent.scrap = 40;
env.waveSpawned = env.waveQuota;   // quota spent
env.zombies.length = 0;            // field clear
env.tick(0.05);
ok('a held wave escalates inside the same episode',
  env.wave === 2 && env.wavesCleared === 1 && !env.done, `wave ${env.wave}, held ${env.wavesCleared}`);
ok('gear carries across the wave boundary',
  env.agent.weapons[2].owned && env.agent.perks.steady && env.agent.scrap === 40);
ok('quota re-scales for the new horde', env.waveQuota === waveQuota(2), `quota ${env.waveQuota}`);
ok('per-wave kill counter resets', env.waveKills === 0 && env.episodeKills >= 0);
env.reset(13);
ok('a fresh episode starts with base gear', !env.agent.weapons[2].owned && env.agent.perkCount === 0 && env.scrapCollected === 0 && env.agent.scrap === CFG.startScrap);

/* --- episode termination -------------------------------------------- */
env.reset(5, { immediate: true });
env.damageAgent(999);
ok('Mara falling terminates the episode',
  env.done && env.outcome === 'dead' && !env.truncated, `${env.outcome}`);

env.reset(7, { immediate: true });
env.damageHouse(CFG.houseMaxHp + 50);
ok('the house falling terminates the episode',
  env.done && env.outcome === 'house' && !env.truncated, `${env.outcome}`);

env.reset(9, { immediate: true });
// Make the defence unbreakable so only the safety cap can end it.
env.agent.hp = 1e6;
env.agent.maxHp = 1e6;
env.houseHp = 1e6;
let capSteps = 0;
while (!env.done && capSteps < 3000) {
  env.step(0, COMBAT.FIRE);
  capSteps += 1;
}
ok('a long defence is truncated, not terminated',
  env.truncated && env.done && env.outcome === null, `truncated at t=${env.time.toFixed(1)}s`);
ok('the safety cap is the CFG limit',
  env.time >= CFG.maxEpisodeTime && env.time <= CFG.maxEpisodeTime + 0.25, `${env.time.toFixed(1)}s`);

function runEpisode(seed, startWave, policy) {
  const e = new Env({ seed, events: true });
  e.reset(seed, { startWave, immediate: true });
  let steps = 0;
  while (!e.done && steps < 3000) {
    e.step(policy.move, policy.combat);
    steps += 1;
  }
  return { outcome: e.outcome, truncated: e.truncated, steps, info: e.info() };
}

const ep = runEpisode(21, 1, { move: 0, combat: COMBAT.FIRE });
ok('an episode ends only when Mara or the house falls',
  ep.outcome === 'dead' || ep.outcome === 'house' || ep.truncated,
  `${ep.outcome ?? 'truncated'} in ${ep.steps} steps`);
ok('no wave-clear termination', ep.outcome !== 'cleared');
ok('quota matches the wave', waveQuota(1) === 9 && ep.info.quota === 9);
const deep = runEpisode(31, 6, { move: 0, combat: COMBAT.FIRE });
ok('higher waves are larger', deep.info.quota > ep.info.quota, `quota ${deep.info.quota}`);

/* reward pieces include gear when pickups are collected */
env.reset(41, { immediate: true });
env.agent.medkits = 0;
env.pickups.push({ id: env.nextId++, kind: 'medkit', active: true, x: env.agent.x, z: env.agent.z });
env.step(0, COMBAT.NONE);
ok('resource shaping recorded', env.rewardParts.resource > 0, `resource ${env.rewardParts.resource}`);

/* --- policy dimensions ---------------------------------------------- */
const { PPOAgent } = await import('./src/sim/ppo.js');
const agent = new PPOAgent();
const act = agent.act(env.getObservation());
ok('policy acts inside the action space',
  act.move >= 0 && act.move < 9 && act.combat >= 0 && act.combat < 8,
  `move ${act.move}, combat ${act.combat}`);
ok('perk list length', PERKS.length === 4);

console.log(fails === 0 ? '\nall checks passed' : `\n${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
