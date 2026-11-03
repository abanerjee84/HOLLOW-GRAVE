import assert from 'node:assert/strict';
import { Env, CFG, OBS_SIZE, OBS_EXTRA, OBS_BASE_SIZE, ACTION_HEADS, actionMasks, UTILITY } from './src/sim/env.js';
import { PPOAgent } from './src/sim/ppo.js';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const fresh = () => new Env({ seed: 42, events: true });
const different = (change) => { const env = fresh(); const before = env.getObservation(); change(env); assert.notDeepEqual(env.getObservation(), before); };

check('transition timers and off-weapon reloads are observable', () => {
  for (const field of ['medCd', 'molotovCd', 'dashT', 'invuln', 'regenT']) different(env => { env.agent[field] = 0.1; });
  different(env => { env.lastTurretTime = env.time; });
  different(env => { env.agent.weapons[1].reloadT = 1; });
  different(env => { env.spawnTimer += 0.2; });
  different(env => { env.pickupTimer += 0.2; });
});

check('fourth turret and crate positions affect the observation', () => {
  const env = fresh();
  env.turrets = Array.from({ length: 4 }, (_, k) => ({ x: k, z: 0, hp: 60, cd: 0 }));
  env.crates = Array.from({ length: 4 }, (_, k) => ({ x: k, z: 1, active: true }));
  let before = env.getObservation(); env.turrets[3].x = 20;
  assert.notDeepEqual(env.getObservation(), before);
  before = env.getObservation(); env.crates[3].z = 20;
  assert.notDeepEqual(env.getObservation(), before);
});

check('perk contents and distant enemy locations are distinguishable', () => {
  const env = fresh();
  env.pickups = [{ x: 10, z: 10, active: true, kind: 'perk', payload: 'vigor' }];
  let before = env.getObservation(); env.pickups[0].payload = 'swift';
  assert.notDeepEqual(env.getObservation(), before);
  env.agent.x = -30; env.agent.z = 0;
  env.zombies = [{ id: 1, x: 10, z: 0, hp: 250, maxHp: 310, dmg: 31.45, speed: 3.2, radius: 0.62, attackCd: 0, typeIndex: 2 }];
  before = env.getObservation(); env.zombies[0].x = 30;
  assert.notDeepEqual(env.getObservation(), before);
  before = env.getObservation(); env.zombies[0].hp = 300;
  assert.notDeepEqual(env.getObservation(), before);
  before = env.getObservation(); env.zombies[0].speed = 3.7;
  assert.notDeepEqual(env.getObservation(), before);
});

check('scrap above 60 and wave above 24 are distinguishable', () => {
  const env = fresh(); env.agent.scrap = 100; env.wave = 24;
  const before = env.getObservation(); env.agent.scrap = 200; env.wave = 25;
  const after = env.getObservation();
  assert.notEqual(before[OBS_EXTRA.scrap], after[OBS_EXTRA.scrap]);
  assert.notEqual(before[OBS_EXTRA.wave], after[OBS_EXTRA.wave]);
});

check('joint tactics can move, select a weapon, fire and dash together', () => {
  const env = fresh(); env.clearEvents();
  const x = env.agent.x;
  env.step({ move: 3, weapon: 2, fire: 1, utility: UTILITY.DASH });
  const events = env.clearEvents().map(e => e.type);
  assert.equal(env.agent.weapon, 1);
  assert.ok(events.includes('swap') && events.includes('shot') && events.includes('dash'));
  assert.ok(env.agent.x - x > CFG.agentSpeed * 0.2);
  assert.equal(env.control.aim, null);
});

check('automatic aim covers the equipped rifle range', () => {
  const env = fresh(); env.agent.weapon = 2; env.agent.weapons[2].owned = true;
  env.zombies = [{ x: env.agent.x + 23, z: env.agent.z, hp: 32 }];
  assert.ok(Math.abs(env.autoAim() - Math.PI / 2) < 1e-8);
});

check('unavailable gear and cooldowns are masked without removing wait', () => {
  const env = fresh(); env.agent.scrap = 0; env.agent.bombs = 0; env.agent.medkits = 0; env.agent.dashCd = 2;
  const masks = actionMasks(env.getObservation());
  assert.equal(masks.weapon[3], 0);
  assert.deepEqual(masks.utility, [1, 0, 0, 0, 0, 0]);
  for (const head of ACTION_HEADS) assert.equal(masks[head.name][0], 1);
});

check('every utility is reachable together with firing in a suitable state', () => {
  const expected = ['shot', 'build', 'molotov', 'dash', 'medkit', 'reload'];
  assert.equal(ACTION_HEADS.reduce((count, head) => count * head.size, 1), 432);
  for (let utility = 0; utility < 6; utility++) {
    const env = fresh(); env.agent.hp = 50; env.agent.weapons[1].mag = 5;
    const masks = actionMasks(env.getObservation(), 2);
    assert.equal(masks.utility[utility], 1);
    env.clearEvents(); env.step({ move: 0, weapon: 2, fire: 1, utility });
    const types = env.clearEvents().map(event => event.type);
    assert.ok(types.includes('shot') && types.includes(expected[utility]));
  }
});

check('saturated inventories and wasted deployments give no positive reward', () => {
  const env = fresh(); env.agent.weapons.forEach(slot => { slot.reserve = CFG.reserveCap; slot.owned = true; });
  env.agent.medkits = CFG.medkitMax; env.agent.bombs = CFG.bombMax; env.agent.scrap = 999;
  for (const kind of ['ammo', 'medkit', 'bomb', 'weapon']) env.collectPickup({ kind, payload: 'rifle', active: true });
  assert.equal(env.pendingReward, 0);
  env.buildTurret(); env.throwMolotov();
  assert.equal(env.pendingReward, 0);
  env.agent.hp = 99; env.useMedkit(); assert.equal(env.pendingReward, 0);
  assert.ok(env.step(0, 0).reward <= 0);
});

check('partial resources change potential; overkill only credits actual damage', () => {
  const env = fresh(); env.agent.weapon = 1; env.agent.weapons[1].reserve = CFG.reserveCap - 1;
  const potential = env.resourcePotential();
  env.collectPickup({ kind: 'ammo', active: true });
  assert.ok(Math.abs(env.resourcePotential() - potential - 0.01) < 1e-8);
  assert.equal(env.pendingReward, 0);
  const before = env.rewardParts.damage;
  env.damageZombie({ hp: 1, type: 'walker', scrap: 5 }, 1000, 'pistol', false);
  assert.equal(env.damageDealt, 1);
  assert.equal(env.rewardParts.damage - before, CFG.reward.damage);
});

check('shoot-reload-refill loop cannot farm shaping reward', () => {
  const env = fresh(); env.agent.weapon = 1; env.agent.weapons[1].reserve = 60;
  env.spawnTimer = env.pickupTimer = 1e6;
  env.crates = Array.from({ length: 4 }, (_, k) => ({ x: 25, z: -k, active: true, value: 12 }));
  const initial = env.resourcePotential();
  let discounted = 0, count = 0;
  const step = utility => {
    const before = env.rewardParts.resource;
    env.step({ move: 0, weapon: 0, fire: +(count === 0), utility });
    discounted += CFG.gamma ** count++ * (env.rewardParts.resource - before);
  };
  step(UTILITY.NONE); step(UTILITY.RELOAD);
  while (env.agent.weapons[1].reloadT > 0) step(UTILITY.NONE);
  env.pickups.push({ kind: 'ammo', x: env.agent.x, z: env.agent.z, active: true });
  step(UTILITY.NONE);
  assert.ok(Math.abs(env.resourcePotential() - initial) < 1e-8);
  assert.ok(discounted < 0);
  assert.ok(Math.abs(discounted - (CFG.gamma ** count - 1) * initial) < 1e-8);
});

check('shaping zeros terminal potential but preserves truncation bootstrap', () => {
  const env = fresh(); env.agent.hp = 1;
  env.zombies = [{ id: 7, x: env.agent.x, z: env.agent.z, hp: 32, maxHp: 32,
    dmg: 8, speed: 0, radius: 0.4, attackCd: 0, type: 'walker', typeIndex: 0, scrap: 5, flash: 0 }];
  const initial = env.resourcePotential();
  env.step(0, 0); assert.equal(env.done, true); assert.equal(env.truncated, false);
  assert.ok(Math.abs(env.rewardParts.resource + initial) < 1e-8);
  const capped = fresh(); capped.time = CFG.maxEpisodeTime - 0.01;
  const phi = capped.resourcePotential(); capped.step(0, 0);
  assert.equal(capped.truncated, true);
  assert.ok(Math.abs(capped.rewardParts.resource - (CFG.gamma - 1) * phi) < 1e-8);
});

check('masked PPO heads reproduce behavior log probabilities and finite gradients', () => {
  const agent = new PPOAgent({ hidden1: 4, hidden2: 3 });
  const obs = fresh().getObservation();
  const sample = agent.act(obs, false, () => 0.1);
  const masks = actionMasks(obs, sample.action.weapon);
  let logp = 0;
  for (const head of agent.heads) {
    assert.equal(masks[head.name][sample.action[head.name]], 1);
    assert.ok(Math.abs(head.p.reduce((sum, p) => sum + p, 0) - 1) < 1e-6);
    logp += head.lp[sample.action[head.name]];
  }
  assert.ok(Math.abs(sample.logp - logp) < 1e-7);
  const stats = { policyLoss: 0, valueLoss: 0, entropy: 0, kl: 0, clipFrac: 0, value: 0, count: 0 };
  const target = sample.value + 0.5, entropyCoef = 0.01, advantage = 0.7;
  agent.accumulate(obs, sample.action, sample.logp, advantage, target, entropyCoef, stats);
  assert.ok(Math.abs(stats.kl) < 1e-7);
  assert.equal(agent.g.b_weapon[3], 0); // unowned rifle
  function objective() {
    const value = agent.forward(obs); let lp = 0, entropy = 0;
    for (const head of agent.heads) {
      const valid = masks[head.name];
      const max = Math.max(...head.logits.filter((_, k) => valid[k]));
      const sum = head.logits.reduce((s, v, k) => s + (valid[k] ? Math.exp(v - max) : 0), 0);
      for (let k = 0; k < head.size; k++) if (valid[k]) {
        const log = head.logits[k] - max - Math.log(sum);
        entropy -= Math.exp(log) * log;
        if (sample.action[head.name] === k) lp += log;
      }
    }
    return -Math.exp(lp - sample.logp) * advantage + agent.cfg.vfCoef * 0.5 * (value - target) ** 2 - entropyCoef * entropy;
  }
  for (const param of ['b_weapon', 'b_fire', 'b_utility', 'W2', 'W1', 'bv']) {
    const before = agent[param][0], delta = 0.001;
    agent[param][0] = before + delta; const high = objective();
    agent[param][0] = before - delta; const low = objective();
    agent[param][0] = before;
    assert.ok(Math.abs((high - low) / (2 * delta) - agent.g[param][0]) < 0.002, param);
  }
});

console.log(`${passed} RL space and reward checks passed; ${OBS_SIZE} observations (${OBS_BASE_SIZE} base).`);
