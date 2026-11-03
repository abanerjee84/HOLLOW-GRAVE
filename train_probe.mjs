/* Headless PPO convergence probe: does the core learn to sustain more waves? */

import { Env, CFG } from './src/sim/env.js';
import { PPOAgent } from './src/sim/ppo.js';
import { evaluatePolicy } from './src/sim/evaluate.js';
import fs from 'node:fs';
const experimentSeed = Number(process.argv[3] || 42);
let randomSeed = experimentSeed;
Math.random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) | 0; return (randomSeed >>> 0) / 4294967296; };

const CONFIG = {
  numEnvs: 14,
  rollout: 96,
  epochs: 4,
  minibatch: 256,
  gamma: CFG.gamma,
  lambda: 0.95,
  clip: 0.2,
  entropyStart: 0.014,
  entropyEnd: 0.004,
};

const ITERATIONS = Number(process.argv[2] || 240);

let agent = new PPOAgent();
const envs = [];
let obs = [];
let returnSum = [];
let episodes = [];
let wavesCleared = 0;   // waves held across every episode so far
let wavesAttempted = 0; // waves faced across every episode so far
let bestWave = 0;       // most waves held inside a single episode
let totalSteps = 0;
const baseSeed = 424242;

for (let i = 0; i < CONFIG.numEnvs; i++) {
  const env = new Env({ seed: baseSeed + i * 7919, events: false, training: true });
  envs.push(env);
  obs.push(env.getObservation());
  returnSum.push(0);
}

function iteration(n) {
  const N = CONFIG.numEnvs, T = CONFIG.rollout;
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
        // An episode is the whole defence: it ends when Mara or the house
        // falls, or rarely when the safety cap truncates it.
        const waves = res.info.wavesCleared;
        wavesCleared += waves;
        wavesAttempted += Math.max(1, res.info.wave);
        bestWave = Math.max(bestWave, waves);
        episodes.push({
          reward: returnSum[e],
          kills: res.info.kills,
          waves,
          wave: res.info.wave,
          outcome: res.info.outcome,
          truncated: !!res.truncated,
        });
        if (episodes.length > 500) episodes = episodes.slice(-400);
        returnSum[e] = 0;
        obs[e] = env.reset(baseSeed + ((Math.random() * 1e9) | 0));
      } else {
        obs[e] = res.obs;
      }
    }
  }

  const adv = new Float32Array(N * T);
  const ret = new Float32Array(N * T);
  const G = CONFIG.gamma, L = CONFIG.lambda;
  for (let e = 0; e < N; e++) {
    // Bootstrap from the state after the last step. A truncated defence keeps
    // that value; a defence that broke bootstraps nothing.
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
    obs: obsList, actions, move: moveList, combat: combatList, logp: logpList, val: valList, rew: rewList, adv, ret,
  }, { epochs: CONFIG.epochs, minibatch: CONFIG.minibatch, entropyCoef });

  const recent = episodes.slice(-40);
  const mean = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : null);
  return {
    iteration: n + 1,
    totalSteps,
    wavesCleared,
    wavesAttempted,
    bestWave,
    holdRate: wavesAttempted ? wavesCleared / wavesAttempted : null,
    meanReward: mean(recent, (e) => e.reward),
    rewardPerWave: mean(recent, (e) => e.reward / Math.max(1, e.waves)),
    meanKills: mean(recent, (e) => e.kills),
    meanEpisodeWaves: mean(recent, (e) => e.waves),
    bestEpisodeWaves: episodes.length ? Math.max(...episodes.map((e) => e.waves)) : 0,
    truncatedShare: recent.length ? recent.filter((e) => e.truncated).length / recent.length : null,
    entropy: stats.entropy,
    policyLoss: stats.policyLoss,
    valueLoss: stats.valueLoss,
  };
}

const t0 = Date.now();
const baseline = evaluatePolicy(agent);
console.log("Fixed-seed baseline", JSON.stringify(baseline));
const history = [];
for (let n = 0; n < ITERATIONS; n++) {
  const m = iteration(n);
  if ((n + 1) % 20 === 0 || n === ITERATIONS - 1) {
    const evaluation = evaluatePolicy(agent);
    history.push({ ...m, evaluation });
    console.log("Fixed-seed evaluation", JSON.stringify({ iteration: n + 1, ...evaluation }));
  }
  if ((n + 1) % 20 === 0 || n === ITERATIONS - 1) {
    console.log(
      `iter ${String(m.iteration).padStart(3)} steps ${String(m.totalSteps).padStart(6)} ` +
      `waves ${m.wavesCleared}/${m.wavesAttempted} best ${m.bestWave} holdRate ${m.holdRate?.toFixed(3)} ` +
      `waves/ep ${m.meanEpisodeWaves?.toFixed(2)} reward/ep ${m.meanReward?.toFixed(1)} ` +
      `reward/wave ${m.rewardPerWave?.toFixed(1)} trunc ${m.truncatedShare?.toFixed(2)} ` +
      `entropy ${m.entropy?.toFixed(2)} valueLoss ${m.valueLoss?.toFixed(1)} ` +
      `${((Date.now() - t0) / 1000).toFixed(0)}s`
    );
  }
}

fs.writeFileSync("learning_report.json", JSON.stringify({ seed: experimentSeed, baseline, history }, null, 2));
