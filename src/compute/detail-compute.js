// Single-point detailed computation for the detail panel.
// Runs on main thread — fast enough for a single (x, a) point.

import { createRng, sampleCategorical } from './prng.js';

// Inline emission probs helper (same pattern as worker.js, avoids cross-module dep)
function emissionProbs(tm, V, S) {
  const probs = new Float64Array(V * S);
  for (let s = 0; s < S; s++) {
    for (let o = 0; o < V; o++) {
      let p = 0;
      for (let j = 0; j < S; j++) p += tm[o * S * S + s * S + j];
      probs[o * S + s] = p;
    }
  }
  return probs;
}

/**
 * Compute per-position loss curve and belief trajectories for a single parameterization.
 *
 * @param {object} process - Process object with transitionMatrix(), entropyRate(), vocabSize, numStates
 * @param {number} x - First parameter value
 * @param {number} a - Second parameter value
 * @param {number} contextLength - Sequence length
 * @param {number} batchSize - Number of sequences to average over
 * @param {number} seed - PRNG seed
 * @returns {{ avgLosses: Float64Array, beliefs: Float64Array[], entropyRate: number, randomGuessing: number }}
 */
export function computeDetailData(process, x, a, contextLength = 256, batchSize = 64, seed = 42) {
  const S = process.numStates;
  const V = process.vocabSize;
  const tm = process.transitionMatrix(x, a);
  const emit = emissionProbs(tm, V, S);

  const avgLosses = new Float64Array(contextLength);
  const sumSqLosses = new Float64Array(contextLength);
  const optimalLosses = new Float64Array(contextLength);
  const sumSqOptimal = new Float64Array(contextLength);
  const beliefs = [];

  const rng = createRng(seed);

  for (let b = 0; b < batchSize; b++) {
    const belief = new Float64Array(S);
    belief.fill(1 / S);
    const seqBeliefs = new Float64Array(contextLength * S);

    for (let t = 0; t < contextLength; t++) {
      // Store belief before observation
      for (let s = 0; s < S; s++) seqBeliefs[t * S + s] = belief[s];

      // Predictive distribution P(obs) = sum_s belief[s] * emit[obs][s]
      const pred = new Float64Array(V);
      for (let o = 0; o < V; o++) {
        for (let s = 0; s < S; s++) pred[o] += belief[s] * emit[o * S + s];
      }

      // Rao-Blackwellized optimal loss: entropy of predictive distribution
      let entropy = 0;
      for (let o = 0; o < V; o++) {
        if (pred[o] > 1e-15) {
          entropy -= pred[o] * Math.log(pred[o]);
        }
      }
      optimalLosses[t] += entropy;
      sumSqOptimal[t] += entropy * entropy;

      // Sample observation
      const obs = sampleCategorical(rng, pred, V);

      // Per-position loss
      const loss = -Math.log(pred[obs] + 1e-15);
      avgLosses[t] += loss;
      sumSqLosses[t] += loss * loss;

      // Belief update: belief'[s'] = sum_s belief[s] * T[obs][s][s']
      const newBelief = new Float64Array(S);
      for (let sp = 0; sp < S; sp++) {
        for (let s = 0; s < S; s++) {
          newBelief[sp] += belief[s] * tm[obs * S * S + s * S + sp];
        }
      }
      let norm = 0;
      for (let s = 0; s < S; s++) norm += newBelief[s];
      if (norm > 0) {
        for (let s = 0; s < S; s++) belief[s] = newBelief[s] / norm;
      }
    }

    beliefs.push(seqBeliefs);
  }

  // Average losses, optimal losses, and compute stddev across batch
  const stdLosses = new Float64Array(contextLength);
  const stdOptimalLosses = new Float64Array(contextLength);
  for (let t = 0; t < contextLength; t++) {
    avgLosses[t] /= batchSize;
    optimalLosses[t] /= batchSize;
    const meanSq = sumSqLosses[t] / batchSize;
    stdLosses[t] = Math.sqrt(Math.max(0, meanSq - avgLosses[t] * avgLosses[t]));
    const meanSqOpt = sumSqOptimal[t] / batchSize;
    stdOptimalLosses[t] = Math.sqrt(Math.max(0, meanSqOpt - optimalLosses[t] * optimalLosses[t]));
  }

  return {
    avgLosses,
    stdLosses,
    optimalLosses,
    stdOptimalLosses,
    beliefs,
    entropyRate: process.entropyRate(x, a),
    randomGuessing: Math.log(V),
  };
}

/**
 * Estimate the asymptotic entropy rate h_μ via dedicated long rollouts.
 * Uses Estimator 2 (entropy of predictive distribution) with fixed parameters
 * independent of the detail panel's Ctx/Batch/Seed settings.
 */
export function estimateEntropyRate(process, x, a, { length = 1024, batch = 16, seed = 7 } = {}) {
  const S = process.numStates;
  const V = process.vocabSize;
  const tm = process.transitionMatrix(x, a);
  const emit = emissionProbs(tm, V, S);
  const rng = createRng(seed);

  const entropies = new Float64Array(length);

  for (let b = 0; b < batch; b++) {
    const belief = new Float64Array(S);
    belief.fill(1 / S);

    for (let t = 0; t < length; t++) {
      // Predictive distribution
      const pred = new Float64Array(V);
      for (let o = 0; o < V; o++)
        for (let s = 0; s < S; s++) pred[o] += belief[s] * emit[o * S + s];

      // Entropy of predictive distribution
      let h = 0;
      for (let o = 0; o < V; o++)
        if (pred[o] > 1e-15) h -= pred[o] * Math.log(pred[o]);
      entropies[t] += h;

      // Sample and update belief
      const obs = sampleCategorical(rng, pred, V);
      const newBelief = new Float64Array(S);
      for (let sp = 0; sp < S; sp++)
        for (let s = 0; s < S; s++)
          newBelief[sp] += belief[s] * tm[obs * S * S + s * S + sp];
      let norm = 0;
      for (let s = 0; s < S; s++) norm += newBelief[s];
      if (norm > 0) for (let s = 0; s < S; s++) belief[s] = newBelief[s] / norm;
    }
  }

  // Average over batch
  for (let t = 0; t < length; t++) entropies[t] /= batch;

  // Tail average: last 20% of the long rollout
  const tailStart = Math.floor(length * 0.8);
  let hMu = 0;
  for (let t = tailStart; t < length; t++) hMu += entropies[t];
  hMu /= (length - tailStart);

  return hMu;
}
