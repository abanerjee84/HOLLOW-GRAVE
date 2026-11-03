// Review-only checks. Regression checks for simulation and PPO behavior.
// Run: node logic_review_checks.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Env, CFG, COMBAT } from './src/sim/env.js';
import { PPOAgent } from './src/sim/ppo.js';

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.log(`FAIL ${name}: ${error.message}`); }
}
const quiet = () => {
  const env = new Env({ seed: 42, events: false });
  env.spawnTimer = 1e6;
  env.pickupTimer = 1e6;
  env.crates = [];
  return env;
};

check('new wave exposes zero kill progress', () => {
  const env = quiet();
  env.waveSpawned = env.waveQuota;
  for (let i = 0; i < env.waveQuota; i++) {
    env.damageZombie({ hp: 1, scrap: 5, type: 'walker' }, 1, 'pistol', false);
  }
  env.tick(0.05);
  assert.equal(env.wave, 2);
  assert.equal(env.getObservation()[9], 0);
});

check('episode reset clears turret deployment cooldown', () => {
  const env = quiet();
  env.time = 20;
  env.buildTurret();
  assert.equal(env.turrets.length, 1);
  env.reset(43);
  env.tick(0.05);
  env.buildTurret();
  assert.equal(env.turrets.length, 1);
});

function fireDamage(dt, count) {
  const env = quiet();
  env.agent.x = 20; env.agent.z = 20;
  const zombie = { id: 999, x: 0, z: 0, hp: 1000, radius: 0.4,
    speed: 0, attackCd: 100, flash: 0, type: 'walker', scrap: 5 };
  env.zombies = [zombie];
  env.fires = [{ x: 0, z: 0, r: CFG.fireRadius, t: 5, tick: 0 }];
  for (let i = 0; i < count; i++) env.tick(dt);
  return 1000 - zombie.hp;
}
check('fire damage agrees between training and 60 FPS over 3 seconds', () => {
  const training = fireDamage(0.05, 60);
  const visible = fireDamage(1 / 60, 180);
  console.log(`  damage: training=${training}, visible=${visible}, configured=${CFG.fireDps * 3}`);
  assert.ok(Math.abs(training - visible) < 1e-6);
});

check('clipping the same mean gradient is independent of minibatch size', () => {
  function gradient(count) {
    const agent = new PPOAgent({ hidden1: 2, hidden2: 2 });
    agent.g.bv[0] = count;
    agent._adamStep(count);
    return agent.m.bv[0] / 0.1;
  }
  const single = gradient(1), batch = gradient(256);
  console.log(`  effective gradients: one=${single}, batch256=${batch}`);
  assert.ok(Math.abs(single - batch) < 1e-6);
});

check('truncated transition bootstraps its own final observation', () => {
  // Run the real worker loop with scripted environment boundaries and critic
  // values. Only imports and browser scheduling are replaced.
  let captured;
  class ScriptEnv {
    constructor() { this.steps = 0; }
    getObservation() { return [1]; }
    reset() { return [100]; }
    step() {
      this.steps++;
      return this.steps === 1
        ? { obs: [10], reward: 0, done: true, truncated: true,
            info: { wavesCleared: 0, wave: 1, kills: 0, time: 480, outcome: null } }
        : { obs: [100 + this.steps - 1], reward: 0, done: false, truncated: false };
    }
  }
  class Critic {
    getWeights() { return new Float32Array(1); }
    act(obs) { return { move: 0, combat: 0, logp: 0, value: obs[0] }; }
    value(obs) { return obs[0]; }
    update(batch) { captured = batch; return {}; }
  }
  const source = fs.readFileSync(new URL('./src/sim/worker.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source + '\nCONFIG.numEnvs = 1; CONFIG.rollout = 3; makeEnvs(); training = true; runIteration();', {
    CFG, evaluatePolicy() { return {}; }, Env: ScriptEnv, PPOAgent: Critic, self: { postMessage() {} },
    setTimeout() {}, clearTimeout() {},
  });
  assert.ok(Math.abs(captured.ret[0] - 9.9) < 1e-5,
    `expected return 9.9 from terminal obs 10; got ${captured.ret[0]}`);
});

check('restored hold rate stays within zero and one', () => {
  let metrics;
  class FailedDefense {
    getObservation() { return [0]; }
    reset() { return [0]; }
    step() { return { obs: [0], reward: 0, done: true, truncated: false,
      info: { wavesCleared: 0, wave: 1, kills: 0, time: 1, outcome: 'house' } }; }
  }
  class Critic {
    getWeights() { return new Float32Array(1); }
    act() { return { move: 0, combat: 0, logp: 0, value: 0 }; }
    value() { return 0; }
    update() { return {}; }
  }
  const source = fs.readFileSync(new URL('./src/sim/worker.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  vm.runInNewContext(source + `
    CONFIG.numEnvs = 1; CONFIG.rollout = 1;
    self.onmessage({ data: { type: 'start', iterations: 10, wavesCleared: 100 } });
    runIteration();`, {
    CFG, evaluatePolicy() { return {}; }, Env: FailedDefense, PPOAgent: Critic,
    self: { postMessage(msg) { if (msg.type === 'metrics') metrics = msg; } },
    setTimeout() {}, clearTimeout() {},
  });
  assert.ok(metrics.holdRate >= 0 && metrics.holdRate <= 1,
    `restored 100 cleared waves, then failed wave 1: hold rate ${metrics.holdRate * 100}%`);
});

check('weapon cycling cannot farm reward', () => {
  const env = quiet();
  for (let i = 0; i < 50; i++) env.step(0, COMBAT.CYCLE);
  assert.equal(env.rewardParts.gear, 0);
});

console.log(`\n${failures} review checks failed.`);
process.exitCode = failures ? 1 : 0;
