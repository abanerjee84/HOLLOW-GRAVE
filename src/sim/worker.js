/* PPO training worker. Runs headless environments and posts metrics + weights. */

import { Env, CFG } from './env.js';
import { PPOAgent } from './ppo.js';
import { evaluatePolicy } from './evaluate.js';

const CONFIG = {
  numEnvs: 14,
  rollout: 96,
  epochs: 4,
  minibatch: 256,
  gamma: CFG.gamma,
  lambda: 0.95,
  clip: 0.2,
  vfCoef: 0.5,
  entropyStart: 0.014,
  entropyEnd: 0.004,
};

let agent = new PPOAgent();
let envs = [];
let obs = [];
let returnSum = [];
let wavesCleared = 0;   // waves held across every episode so far
let wavesAttempted = 0; // waves faced across every episode so far
let bestWave = 0;       // most waves held inside a single episode
let training = false;
let iteration = 0;
let totalSteps = 0;
let episodes = [];
let lastMetrics = null;
let baseline = null;
let evaluation = null;
let timer = null;
let baseSeed = (Date.now() % 100000) | 0;

function makeEnvs() {
  envs = [];
  obs = [];
  returnSum = [];
  for (let i = 0; i < CONFIG.numEnvs; i++) {
    const env = new Env({ seed: baseSeed + i * 7919, events: false, training: true });
    envs.push(env);
    obs.push(env.getObservation());
    returnSum.push(0);
  }
}

function broadcastWeights() {
  const w = agent.getWeights().slice();
  self.postMessage({ type: 'weights', data: w, iteration, totalSteps }, [w.buffer]);
}

function resetAll(newAgent = true) {
  if (newAgent) agent = new PPOAgent();
  iteration = 0;
  totalSteps = 0;
  episodes = [];
  wavesCleared = 0;
  wavesAttempted = 0;
  bestWave = 0;
  lastMetrics = null;
  baseline = null;
  evaluation = null;
  baseSeed = (Date.now() % 100000) | 0;
  makeEnvs();
  broadcastWeights();
  self.postMessage({
    type: 'status', training: false, iteration: 0, totalSteps: 0,
    message: newAgent ? 'Core reinitialised.' : 'Core ready.',
  });
}

function runIteration() {
  if (!training) return;
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
      totalSteps++;
      returnSum[e] += res.reward;
      rewList[idx] = res.reward;
      doneList[idx] = res.done ? 1 : 0;
      truncList[idx] = res.truncated ? 1 : 0;
      if (res.truncated) terminalValues[idx] = agent.value(res.obs);

      if (res.done) {
        const info = res.info;
        // One episode is one whole defence: it ends when Mara or the house
        // falls (or, rarely, when the safety cap truncates it).
        const waves = info.wavesCleared;
        wavesCleared += waves;
        wavesAttempted += Math.max(1, info.wave);
        bestWave = Math.max(bestWave, waves);
        episodes.push({
          reward: returnSum[e],
          kills: info.kills,
          waves,
          wave: info.wave,
          time: info.time,
          outcome: info.outcome,
          truncated: !!res.truncated,
        });
        if (episodes.length > 500) episodes = episodes.slice(-400);
        returnSum[e] = 0;
        // The next episode is a fresh defence from wave 1 with base gear.
        obs[e] = env.reset(baseSeed + ((Math.random() * 1e9) | 0));
      } else {
        obs[e] = res.obs;
      }
    }
  }

  // GAE
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

  const entropyCoef = CONFIG.entropyEnd
    + (CONFIG.entropyStart - CONFIG.entropyEnd) * Math.exp(-iteration / 90);

  const stats = agent.update({
    obs: obsList, actions,
    move: moveList,
    combat: combatList,
    logp: logpList,
    val: valList,
    rew: rewList,
    adv,
    ret,
  }, {
    epochs: CONFIG.epochs,
    minibatch: CONFIG.minibatch,
    entropyCoef,
  });

  iteration += 1;
  if (iteration % 10 === 0) evaluation = { ...evaluatePolicy(agent), iteration };

  const recent = episodes.slice(-40);
  const meanReward = recent.length ? recent.reduce((s, e) => s + e.reward, 0) / recent.length : null;
  const bestReward = episodes.length ? Math.max(...episodes.map((e) => e.reward)) : null;
  const meanKills = recent.length ? recent.reduce((s, e) => s + e.kills, 0) / recent.length : null;
  const meanTime = recent.length ? recent.reduce((s, e) => s + e.time, 0) / recent.length : null;
  const meanWave = recent.length ? recent.reduce((s, e) => s + e.wave, 0) / recent.length : null;
  // How many waves a defence sustains before it breaks.
  const meanEpisodeWaves = recent.length ? recent.reduce((s, e) => s + e.waves, 0) / recent.length : null;
  const bestRunWaves = episodes.length ? Math.max(...episodes.map((e) => e.waves)) : 0;
  const holdRate = wavesAttempted ? wavesCleared / wavesAttempted : null;
  const outcomes = { dead: 0, house: 0, truncated: 0 };
  for (const e of recent) outcomes[e.truncated ? 'truncated' : e.outcome] += 1;

  lastMetrics = {
    type: 'metrics',
    baseline,
    evaluation,
    iteration,
    totalSteps,
    episodes: episodes.length,
    wavesCleared,
    wavesAttempted,
    bestWave: Math.max(bestWave, bestRunWaves),
    meanEpisodeWaves,
    meanRunWaves: meanEpisodeWaves,   // kept for the HUD label "waves / episode"
    holdRate,
    clearRate: holdRate,              // kept for the HUD label "hold rate"
    meanReward,
    bestReward,
    meanKills,
    meanTime,
    meanWave,
    outcomes,
    policyLoss: stats.policyLoss,
    valueLoss: stats.valueLoss,
    entropy: stats.entropy,
    kl: stats.kl,
    clipFrac: stats.clipFrac,
    lr: agent.lr,
    entropyCoef,
    recent: recent.map((e) => Math.round(e.reward * 10) / 10),
    recentWaves: recent.map((e) => e.waves),
  };
  broadcastWeights();
  self.postMessage(lastMetrics);

  timer = setTimeout(runIteration, 0);
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case 'init':
      if (msg.weights) agent.setWeights(msg.weights);
      if (msg.iteration) iteration = msg.iteration;
      if (typeof msg.wavesCleared === 'number') wavesCleared = msg.wavesCleared;
      wavesAttempted = Math.max(wavesCleared, msg.wavesAttempted || 0);
      totalSteps = msg.totalSteps || 0;
      if (typeof msg.bestWave === 'number') bestWave = msg.bestWave;
      makeEnvs();
      broadcastWeights();
      self.postMessage({
        type: 'status', training: false, iteration, totalSteps: 0,
        message: 'Simulation officer online.',
      });
      break;

    case 'start': {
      if (msg.weights && msg.weights.length === agent.weightCount()) {
        agent.setWeights(msg.weights);
      }
      if (msg.fresh) {
        agent = new PPOAgent();
        iteration = 0;
        totalSteps = 0;
        episodes = [];
        wavesCleared = 0;
        wavesAttempted = 0;
        bestWave = 0;
      }
      if (typeof msg.wavesCleared === 'number') wavesCleared = Math.max(wavesCleared, msg.wavesCleared);
      wavesAttempted = Math.max(wavesAttempted, wavesCleared, msg.wavesAttempted || 0);
      totalSteps = Math.max(totalSteps, msg.totalSteps || 0);
      if (typeof msg.bestWave === 'number') bestWave = Math.max(bestWave, msg.bestWave);
      if (!envs.length) makeEnvs();
      if (msg.iterations && msg.iterations > iteration) iteration = msg.iterations;
      baseline = msg.baseline || baseline || evaluatePolicy(agent);
      evaluation = msg.evaluation || evaluation || { ...baseline, iteration };
      self.postMessage({ type: 'evaluation', baseline, evaluation });
      training = true;
      // Push the current policy to the renderer immediately, even before the
      // first optimisation step, so the field agent is always PPO-controlled.
      broadcastWeights();
      self.postMessage({
        type: 'status', training: true, iteration, totalSteps,
        message: 'Policy optimisation running in worker.',
      });
      clearTimeout(timer);
      timer = setTimeout(runIteration, 0);
      break;
    }

    case 'pause':
      training = false;
      clearTimeout(timer);
      broadcastWeights();
      self.postMessage({ type: 'status', training: false, iteration, totalSteps, message: 'Training paused.' });
      break;

    case 'resume':
      if (!training) {
        training = true;
        clearTimeout(timer);
        timer = setTimeout(runIteration, 0);
        self.postMessage({ type: 'status', training: true, iteration, totalSteps, message: 'Training resumed.' });
      }
      break;

    case 'reset':
      training = false;
      clearTimeout(timer);
      resetAll(true);
      break;

    case 'synth':
      // Debug: run N env steps with random actions without learning.
      if (!envs.length) makeEnvs();
      for (let i = 0; i < (msg.steps || 200); i++) {
        for (let e = 0; e < envs.length; e++) {
          const a = agent.act(obs[e]);
          const r = envs[e].step(a.action || a.move, a.combat);
          if (!r.done) {
            obs[e] = r.obs;
            returnSum[e] += r.reward;
            continue;
          }
          const waves = r.info.wavesCleared;
          wavesCleared += waves;
          wavesAttempted += Math.max(1, r.info.wave);
          bestWave = Math.max(bestWave, waves);
          episodes.push({
            reward: returnSum[e],
            kills: r.info.kills,
            waves,
            wave: r.info.wave,
            time: r.info.time,
            outcome: r.info.outcome,
            truncated: !!r.truncated,
          });
          returnSum[e] = 0;
          obs[e] = envs[e].reset((Math.random() * 1e9) | 0);
        }
      }
      self.postMessage({ type: 'status', training: false, iteration, totalSteps, message: 'Synth test complete.' });
      break;

    default:
      break;
  }
};

// Let the main thread know the worker is alive and hand over initial weights.
self.postMessage({
  type: 'ready',
  weights: agent.getWeights(),
  iteration: 0,
  totalSteps: 0,
});
