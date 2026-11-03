/* Action + gear diagnostic: what does the policy actually choose?
   Trains briefly, then compares deterministic (UI) vs sampled (training)
   action distributions and logs weapon swaps, pickups, turrets, molotovs. */

import { Env, CFG, ACTION_HEADS, MOVE_COUNT, COMBAT_COUNT } from './src/sim/env.js';
import { PPOAgent } from './src/sim/ppo.js';

const ITERS = Number(process.argv[2] || 60);
const EPISODES = Number(process.argv[3] || 4);
const CONFIG = {
  numEnvs: 14, rollout: 96, epochs: 4, minibatch: 256,
  gamma: CFG.gamma, lambda: 0.95, clip: 0.2,
  entropyStart: 0.014, entropyEnd: 0.004,
};

const MOVE_NAMES = ['STAY', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMBAT_NAMES = ['NONE', 'FIRE', 'CYCLE', 'TURRET', 'MOLOTOV', 'DASH', 'MEDKIT', 'RELOAD'];

function makeEnvs(n, seedBase) {
  const envs = [];
  for (let i = 0; i < n; i++) {
    envs.push(new Env({ seed: seedBase + i * 7919, events: false, training: true }));
  }
  return envs;
}

function train(agent, iterations) {
  const N = CONFIG.numEnvs, T = CONFIG.rollout;
  const envs = makeEnvs(N, 12345);
  const obs = envs.map((e) => e.getObservation());
  const returnSum = new Array(N).fill(0);
  let totalSteps = 0, wavesCleared = 0, wavesAttempted = 0, best = 0;

  for (let n = 0; n < iterations; n++) {
    const obsList = [];
    const actions = [];
    const moveList = new Uint8Array(N * T);
    const combatList = new Uint8Array(N * T);
    const logpList = new Float32Array(N * T);
    const valList = new Float32Array(N * T);
    const rewList = new Float32Array(N * T);
    const doneList = new Uint8Array(N * T);
    const truncList = new Uint8Array(N * T);
    const terminalValues = new Float32Array(N * T);

    for (let t = 0; t < T; t++) {
      for (let e = 0; e < N; e++) {
        const idx = t * N + e;
        const env = envs[e];
        const o = obs[e];
        obsList.push(o);
        const a = agent.act(o);
        moveList[idx] = a.move;
        combatList[idx] = a.combat;
        actions.push(a.action);
        logpList[idx] = a.logp;
        valList[idx] = a.value;
        const res = env.step(a.action || a.move, a.combat);
        totalSteps += 1;
        returnSum[e] += res.reward;
        rewList[idx] = res.reward;
        doneList[idx] = res.done ? 1 : 0;
        truncList[idx] = res.truncated ? 1 : 0;
        if (res.truncated) terminalValues[idx] = agent.value(res.obs);
        if (res.done) {
          const w = res.info.wavesCleared;
          wavesCleared += w;
          wavesAttempted += Math.max(1, res.info.wave);
          best = Math.max(best, w);
          returnSum[e] = 0;
          obs[e] = env.reset(((Math.random() * 1e9) | 0));
        } else {
          obs[e] = res.obs;
        }
      }
    }

    const adv = new Float32Array(N * T);
    const ret = new Float32Array(N * T);
    const G = CONFIG.gamma, L = CONFIG.lambda;
    for (let e = 0; e < N; e++) {
      let nextVal = agent.value(obs[e]);
      let nextGae = 0;
      for (let t = T - 1; t >= 0; t--) {
        const idx = t * N + e;
        if (truncList[idx]) { nextVal = terminalValues[idx]; nextGae = 0; }
        else if (doneList[idx]) { nextVal = 0; nextGae = 0; }
        const delta = rewList[idx] + G * nextVal - valList[idx];
        const gae = delta + G * L * nextGae;
        adv[idx] = gae;
        ret[idx] = gae + valList[idx];
        nextVal = valList[idx];
        nextGae = gae;
      }
    }

    const entropyCoef = CONFIG.entropyEnd + (CONFIG.entropyStart - CONFIG.entropyEnd) * Math.exp(-n / 90);
    const stats = agent.update({
      obs: obsList, actions, move: moveList, combat: combatList, logp: logpList,
      val: valList, rew: rewList, adv, ret,
    }, { epochs: CONFIG.epochs, minibatch: CONFIG.minibatch, entropyCoef });

    if ((n + 1) % 20 === 0 || n === iterations - 1) {
      console.log(
        `train ${String(n + 1).padStart(3)} steps ${String(totalSteps).padStart(6)} ` +
        `waves ${wavesCleared}/${wavesAttempted} best ${best} entropy ${stats.entropy.toFixed(2)}`
      );
    }
  }
}

function evaluate(agent, deterministic) {
  const env = new Env({ seed: 424242, events: true, training: false });
  let obs = env.reset(424242, { immediate: true });
  const moveCounts = new Array(MOVE_COUNT).fill(0);
  const combatCounts = new Array(COMBAT_COUNT).fill(0);
  const actionCounts = Object.fromEntries(ACTION_HEADS.map(h => [h.name, Array(h.size).fill(0)]));
  const gear = { swap: 0, pickup: 0, weapon: 0, perk: 0, build: 0, molotov: 0, medkit: 0, ammo: 0 };
  let waves = 0, steps = 0, kills = 0;

  while (!env.done && steps < 3000) {
    const act = agent.act(obs, deterministic);
    moveCounts[act.move] += 1;
    combatCounts[act.combat] += 1;
    for (const head of ACTION_HEADS) actionCounts[head.name][act.action[head.name]]++;
    const res = env.step(act.action || act.move, act.combat);
    steps += 1;
    kills = res.info.kills;
    for (const e of env.clearEvents()) {
      if (e.type === 'swap') gear.swap += 1;
      else if (e.type === 'build') gear.build += 1;
      else if (e.type === 'molotov') gear.molotov += 1;
      else if (e.type === 'medkit') gear.medkit += 1;
      else if (e.type === 'pickup') {
        gear.pickup += 1;
        if (e.kind === 'weapon') gear.weapon += 1;
        else if (e.kind === 'perk') gear.perk += 1;
        else if (e.kind === 'ammo') gear.ammo += 1;
      }
    }
    if (res.done) { waves = res.info.wavesCleared; break; }
    obs = res.obs;
  }
  return { waves, steps, kills, actionCounts, moveCounts, combatCounts, gear, outcome: env.outcome };
}

function summarize(label, runs) {
  const moves = new Array(MOVE_COUNT).fill(0);
  const combat = new Array(COMBAT_COUNT).fill(0);
  const gear = { swap: 0, pickup: 0, weapon: 0, perk: 0, build: 0, molotov: 0, medkit: 0, ammo: 0 };
  const totals = Object.fromEntries(ACTION_HEADS.map(h => [h.name, Array(h.size).fill(0)]));
  let waves = 0, steps = 0;
  for (const r of runs) {
    for (const head of ACTION_HEADS) r.actionCounts[head.name].forEach((count, i) => { totals[head.name][i] += count; });
    r.moveCounts.forEach((v, i) => { moves[i] += v; });
    r.combatCounts.forEach((v, i) => { combat[i] += v; });
    for (const k in gear) gear[k] += r.gear[k];
    waves += r.waves;
    steps += r.steps;
  }
  const total = steps || 1;
  console.log(`\n=== ${label} (${runs.length} episodes) ===`);
  console.log(`  waves held: ${waves}  avg/ep: ${(waves / runs.length).toFixed(2)}  steps: ${steps}`);
  console.log('  move  : ' + moves.map((v, i) => `${MOVE_NAMES[i]} ${(100 * v / total).toFixed(1)}%`).join('  '));
  const labels = { weapon: ['KEEP', 'SIDEARM', 'SHOTGUN', 'RIFLE'], fire: ['HOLD', 'FIRE'], utility: ['NONE', 'TURRET', 'MOLOTOV', 'DASH', 'MEDKIT', 'RELOAD'] };
  for (const name of ['weapon', 'fire', 'utility']) console.log('  ' + name + ': ' + totals[name].map((count, i) => labels[name][i] + ' ' + (100 * count / total).toFixed(1) + '%').join('  '));
  console.log('  gear  : ' + Object.entries(gear).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') || '  gear  : none');
}

const agent = new PPOAgent();
train(agent, ITERS);

const detRuns = [], stoRuns = [];
for (let i = 0; i < EPISODES; i++) detRuns.push(evaluate(agent, true));
for (let i = 0; i < EPISODES; i++) stoRuns.push(evaluate(agent, false));
summarize('greedy comparison', detRuns);
summarize('sampled (live UI and training)', stoRuns);
