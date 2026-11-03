import { Env } from './env.js';

// Held-out seeds never enter the worker's training rollouts. Action sampling
// has its own seeded stream, so evaluations do not consume training randomness.
export const EVAL_SEEDS = [104729, 130363, 155921, 196613];
function randomStream(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function evaluatePolicy(agent, seeds = EVAL_SEEDS) {
  const runs = seeds.map(seed => {
    const env = new Env({ seed, events: false });
    const rng = randomStream(seed ^ 0x51f15e);
    let obs = env.getObservation();
    while (!env.done) {
      const action = agent.act(obs, false, rng);
      obs = env.step(action.action || action.move, action.combat).obs;
    }
    return { seed, kills: env.episodeKills, waves: env.wavesCleared,
      seconds: env.time, reward: env.episodeReward };
  });
  const mean = key => runs.reduce((sum, run) => sum + run[key], 0) / runs.length;
  return { kills: mean('kills'), waves: mean('waves'), seconds: mean('seconds'),
    reward: mean('reward'), runs };
}
