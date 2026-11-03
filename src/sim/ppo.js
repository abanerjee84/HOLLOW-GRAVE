/* PPO with a shared critic and independently sampled tactical action heads. */

import { OBS_SIZE, ACTION_HEADS, actionMasks, COMBAT, CFG } from './env.js';

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function initMatrix(rows, cols, gain = 1) {
  const a = new Float32Array(rows * cols);
  const std = gain * Math.sqrt(2 / (rows + cols));
  for (let i = 0; i < a.length; i++) a[i] = randn() * std;
  return a;
}

function softmax(logits, out) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const v = Math.exp(logits[i] - max);
    out[i] = v;
    sum += v;
  }
  const inv = 1 / sum;
  for (let i = 0; i < out.length; i++) out[i] *= inv;
}

function logSoftmax(logits, outP, outLog, mask) {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (mask[i]) max = Math.max(max, logits[i]);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    outP[i] = mask[i] ? Math.exp(logits[i] - max) : 0;
    sum += outP[i];
  }
  let entropy = 0;
  for (let i = 0; i < logits.length; i++) {
    outP[i] /= sum;
    outLog[i] = mask[i] ? logits[i] - max - Math.log(sum) : 0;
    entropy -= outP[i] * outLog[i];
  }
  return entropy;
}

function sampleCategorical(probs, rng = Math.random) {
  let r = rng();
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i];
    if (r <= 0) return i;
  }
  return probs.length - 1;
}

function argmax(arr) {
  let bi = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[bi]) bi = i;
  return bi;
}

export const DEFAULT_CONFIG = {
  hidden1: 128,
  hidden2: 96,
  lr: 5e-4,
  gamma: CFG.gamma,
  lambda: 0.95,
  clip: 0.2,
  vfCoef: 0.5,
  entropyCoef: 0.008,
  maxGradNorm: 0.6,
  epochs: 4,
  minibatch: 256,
};

export class PPOAgent {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    const { hidden1: H1, hidden2: H2 } = this.cfg;
    const O = OBS_SIZE;

    this.W1 = initMatrix(H1, O, 1.0);
    this.b1 = new Float32Array(H1);
    this.W2 = initMatrix(H2, H1, 1.0);
    this.b2 = new Float32Array(H2);
    this.heads = ACTION_HEADS.map(({ name, size }) => {
      const weight = 'W_' + name, bias = 'b_' + name;
      this[weight] = initMatrix(size, H2, 0.06);
      this[bias] = new Float32Array(size);
      return { name, size, weight, bias, logits: new Float32Array(size),
        p: new Float32Array(size), lp: new Float32Array(size), d: new Float32Array(size) };
    });
    this.Wv = initMatrix(1, H2, 0.25);
    this.bv = new Float32Array(1);
    this.params = ['W1', 'b1', 'W2', 'b2', ...this.heads.flatMap(h => [h.weight, h.bias]), 'Wv', 'bv'];
    this.m = {}; this.v = {};
    for (const p of this.params) {
      this.m[p] = new Float32Array(this[p].length);
      this.v[p] = new Float32Array(this[p].length);
    }
    this.adamT = 0;

    this.h1 = new Float32Array(H1);
    this.h2 = new Float32Array(H2);
    this.z1 = new Float32Array(H1);
    this.z2 = new Float32Array(H2);
    // gradients (accumulated over a mini-batch)
    this.g = {};
    this.zeroGrads();

    this.lr = this.cfg.lr;
    this.totalUpdates = 0;
  }

  initGrads() {
    for (const p of this.params) this.g[p] = new Float32Array(this[p].length);
  }

  zeroGrads() {
    if (!this.g.W1) this.initGrads();
    for (const p of this.params) this.g[p].fill(0);
  }

  forward(obs) {
    const { W1, b1, W2, b2, Wv, bv } = this;
    const H1 = this.cfg.hidden1, H2 = this.cfg.hidden2;
    for (let i = 0; i < H1; i++) {
      let s = b1[i];
      const off = i * OBS_SIZE;
      for (let k = 0; k < OBS_SIZE; k++) s += W1[off + k] * obs[k];
      this.z1[i] = s;
      this.h1[i] = Math.tanh(s);
    }
    for (let i = 0; i < H2; i++) {
      let s = b2[i];
      const off = i * H1;
      for (let k = 0; k < H1; k++) s += W2[off + k] * this.h1[k];
      this.z2[i] = s;
      this.h2[i] = Math.tanh(s);
    }
    for (const head of this.heads) {
      for (let i = 0; i < head.size; i++) {
        let sum = this[head.bias][i];
        for (let k = 0; k < H2; k++) sum += this[head.weight][i * H2 + k] * this.h2[k];
        head.logits[i] = sum;
      }
    }
    let value = bv[0];
    for (let k = 0; k < H2; k++) value += Wv[k] * this.h2[k];
    return value;
  }

  act(obs, deterministic = false, rng = Math.random) {
    const value = this.forward(obs);
    const action = {};
    let logp = 0, entropy = 0;
    const confidence = {};
    for (const head of this.heads) {
      const mask = actionMasks(obs, action.weapon || 0)[head.name];
      entropy += logSoftmax(head.logits, head.p, head.lp, mask);
      const choice = deterministic ? argmax(head.p) : sampleCategorical(head.p, rng);
      action[head.name] = choice;
      confidence[head.name] = head.p[choice];
      logp += head.lp[choice];
    }
    const utilityCombat = [COMBAT.NONE, COMBAT.TURRET, COMBAT.MOLOTOV, COMBAT.DASH, COMBAT.MEDKIT, COMBAT.RELOAD];
    return { action, move: action.move, combat: utilityCombat[action.utility] || (action.fire ? COMBAT.FIRE : COMBAT.NONE),
      logp, value, entropy, confidence };
  }

  value(obs) {
    return this.forward(obs);
  }

  /* Accumulate gradients for one sample. */
  accumulate(obs, actions, oldLogp, advantage, ret, entropyCoef, out) {
    const { W1, W2, Wv } = this;
    const H1 = this.cfg.hidden1, H2 = this.cfg.hidden2;
    const value = this.forward(obs);
    const masks = actionMasks(obs, actions.weapon);
    let entropy = 0, newLogp = 0;
    const entropies = [];
    for (const head of this.heads) {
      const H = logSoftmax(head.logits, head.p, head.lp, masks[head.name]);
      entropies.push(H); entropy += H;
      if (!masks[head.name][actions[head.name]]) throw new Error('Masked action in PPO batch: ' + head.name);
      newLogp += head.lp[actions[head.name]];
    }
    const ratio = Math.exp(Math.max(-20, Math.min(20, newLogp - oldLogp)));
    const clip = this.cfg.clip;
    const clipped = Math.max(1 - clip, Math.min(1 + clip, ratio));
    const surr1 = ratio * advantage;
    const surr2 = clipped * advantage;
    const policyLoss = -Math.min(surr1, surr2);
    const vLoss = 0.5 * (value - ret) ** 2;

    let dLogp = 0;
    if (surr1 <= surr2) dLogp = -advantage * ratio;

    for (let n = 0; n < this.heads.length; n++) {
      const head = this.heads[n];
      for (let i = 0; i < head.size; i++) {
        head.d[i] = masks[head.name][i] ? dLogp * ((i === actions[head.name] ? 1 : 0) - head.p[i])
          + entropyCoef * head.p[i] * (head.lp[i] + entropies[n]) : 0;
        this.g[head.bias][i] += head.d[i];
        for (let q = 0; q < H2; q++) this.g[head.weight][i * H2 + q] += head.d[i] * this.h2[q];
      }
    }
    const dV = this.cfg.vfCoef * (value - ret);
    for (let k = 0; k < H2; k++) this.g.Wv[k] += dV * this.h2[k];
    this.g.bv[0] += dV;

    // hidden 2
    const dz2 = new Float32Array(H2);
    for (let k = 0; k < H2; k++) {
      let sum = 0;
      for (const head of this.heads) {
        for (let i = 0; i < head.size; i++) sum += this[head.weight][i * H2 + k] * head.d[i];
      }
      sum += Wv[k] * dV;
      dz2[k] = sum * (1 - this.h2[k] * this.h2[k]);
      this.g.b2[k] += dz2[k];
    }
    for (let i = 0; i < H2; i++) {
      const d = dz2[i];
      const off = i * H1;
      for (let k = 0; k < H1; k++) this.g.W2[off + k] += d * this.h1[k];
    }

    // hidden 1
    const dz1 = new Float32Array(H1);
    for (let k = 0; k < H1; k++) {
      let sum = 0;
      for (let i = 0; i < H2; i++) sum += W2[i * H1 + k] * dz2[i];
      dz1[k] = sum * (1 - this.h1[k] * this.h1[k]);
      this.g.b1[k] += dz1[k];
    }
    for (let i = 0; i < H1; i++) {
      const d = dz1[i];
      const off = i * OBS_SIZE;
      for (let k = 0; k < OBS_SIZE; k++) this.g.W1[off + k] += d * obs[k];
    }

    out.policyLoss += policyLoss;
    out.valueLoss += vLoss;
    out.entropy += entropy;
    out.kl += oldLogp - newLogp;
    out.clipFrac += (Math.abs(ratio - 1) > clip) ? 1 : 0;
    out.value += value;
    out.count += 1;
  }

  _adamStep(count) {
    // global gradient clipping
    let sq = 0;
    for (const p of this.params) {
      const g = this.g[p];
      for (let i = 0; i < g.length; i++) sq += g[i] * g[i];
    }
    const invN = 1 / Math.max(1, count);
    const norm = Math.sqrt(sq) * invN;
    const scale = norm > this.cfg.maxGradNorm ? this.cfg.maxGradNorm / (norm + 1e-9) : 1;

    this.adamT += 1;
    const b1 = 0.9, b2 = 0.999, eps = 1e-5;
    const bc1 = 1 - Math.pow(b1, this.adamT);
    const bc2 = 1 - Math.pow(b2, this.adamT);
    const stepSize = this.lr * Math.sqrt(bc2) / bc1;

    for (const p of this.params) {
      const w = this[p], g = this.g[p], m = this.m[p], v = this.v[p];
      for (let i = 0; i < w.length; i++) {
        const grad = g[i] * invN * scale;
        m[i] = b1 * m[i] + (1 - b1) * grad;
        v[i] = b2 * v[i] + (1 - b2) * grad * grad;
        w[i] -= stepSize * m[i] / (Math.sqrt(v[i]) + eps);
      }
    }
    this.zeroGrads();
  }

  update(batch, cfg = {}) {
    const epochs = cfg.epochs ?? this.cfg.epochs;
    const minibatch = cfg.minibatch ?? this.cfg.minibatch;
    const entropyCoef = cfg.entropyCoef ?? this.cfg.entropyCoef;
    const n = batch.obs.length;

    // normalize advantages
    let mean = 0;
    for (let i = 0; i < n; i++) mean += batch.adv[i];
    mean /= n;
    let varSum = 0;
    for (let i = 0; i < n; i++) { const d = batch.adv[i] - mean; varSum += d * d; }
    const std = Math.sqrt(varSum / n) + 1e-8;
    for (let i = 0; i < n; i++) batch.adv[i] = (batch.adv[i] - mean) / std;

    const stats = { policyLoss: 0, valueLoss: 0, entropy: 0, kl: 0, clipFrac: 0, value: 0, count: 0 };
    const indices = new Uint32Array(n);
    for (let i = 0; i < n; i++) indices[i] = i;

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Fisher-Yates
      for (let i = n - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
      }
      for (let start = 0; start < n; start += minibatch) {
        const end = Math.min(n, start + minibatch);
        const batchStats = { policyLoss: 0, valueLoss: 0, entropy: 0, kl: 0, clipFrac: 0, value: 0, count: 0 };
        for (let k = start; k < end; k++) {
          const idx = indices[k];
          this.accumulate(
            batch.obs[idx], batch.actions[idx],
            batch.logp[idx], batch.adv[idx], batch.ret[idx], entropyCoef, batchStats
          );
        }
        this._adamStep(end - start);
        for (const key of Object.keys(stats)) stats[key] += batchStats[key];
      }
    }
    const c = Math.max(1, stats.count);
    this.totalUpdates++;
    // gentle entropy / lr decay
    this.lr = Math.max(8e-5, this.lr * 0.9995);
    return {
      policyLoss: stats.policyLoss / c,
      valueLoss: stats.valueLoss / c,
      entropy: stats.entropy / c,
      kl: stats.kl / c,
      clipFrac: stats.clipFrac / c,
      meanValue: stats.value / c,
    };
  }

  getWeights() {
    let total = 0;
    for (const p of this.params) total += this[p].length;
    const out = new Float32Array(total);
    let off = 0;
    for (const p of this.params) {
      out.set(this[p], off);
      off += this[p].length;
    }
    return out;
  }

  setWeights(data) {
    if (!data || data.length !== this.weightCount()) return false;
    let off = 0;
    for (const p of this.params) {
      this[p].set(data.subarray(off, off + this[p].length));
      off += this[p].length;
    }
    return true;
  }

  weightCount() {
    let total = 0;
    for (const p of this.params) total += this[p].length;
    return total;
  }
}
