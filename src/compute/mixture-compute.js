// Mixture computation: runs per-component detail data and computes weighted averages.

import { computeDetailData, estimateEntropyRate } from './detail-compute.js';
import { getProcess } from '../processes/registry.js';

/**
 * Compute detail data for a multi-delta mixture.
 *
 * @param {string} processName - Process registry name
 * @param {Array} components - Array of { x, a, weight, nx, na }
 * @param {number} contextLength
 * @param {number} batchSize
 * @param {number} seed
 * @returns {{ perComponent: Array, mixtureAvgLosses: Float64Array, mixtureOptimalLosses: Float64Array,
 *             mixtureStdLosses: Float64Array, mixtureStdOptimal: Float64Array,
 *             compositeEntropyRate: number, compositeHMu: number, randomGuessing: number }}
 */
export function computeMixtureData(processName, components, contextLength = 256, batchSize = 64, seed = 42) {
  const process = getProcess(processName);
  const perComponent = [];

  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    const data = computeDetailData(process, c.x, c.a, contextLength, batchSize, seed);
    data.hMu = estimateEntropyRate(process, c.x, c.a);
    perComponent.push(data);
  }

  const weights = components.map(c => c.weight);
  const ctxLen = contextLength;

  // Weighted average of per-component curves
  const mixtureAvgLosses = new Float64Array(ctxLen);
  const mixtureOptimalLosses = new Float64Array(ctxLen);
  const mixtureStdLosses = new Float64Array(ctxLen);
  const mixtureStdOptimal = new Float64Array(ctxLen);

  for (let t = 0; t < ctxLen; t++) {
    let avgL = 0, avgOpt = 0, avgStdL = 0, avgStdOpt = 0;
    for (let i = 0; i < components.length; i++) {
      avgL += weights[i] * perComponent[i].avgLosses[t];
      avgOpt += weights[i] * perComponent[i].optimalLosses[t];
      avgStdL += weights[i] * perComponent[i].stdLosses[t];
      avgStdOpt += weights[i] * perComponent[i].stdOptimalLosses[t];
    }
    mixtureAvgLosses[t] = avgL;
    mixtureOptimalLosses[t] = avgOpt;
    mixtureStdLosses[t] = avgStdL;
    mixtureStdOptimal[t] = avgStdOpt;
  }

  // Weighted composite entropy rate and hMu
  let compositeEntropyRate = 0;
  let compositeHMu = 0;
  for (let i = 0; i < components.length; i++) {
    compositeEntropyRate += weights[i] * perComponent[i].entropyRate;
    compositeHMu += weights[i] * perComponent[i].hMu;
  }

  return {
    perComponent,
    mixtureAvgLosses,
    mixtureOptimalLosses,
    mixtureStdLosses,
    mixtureStdOptimal,
    compositeEntropyRate,
    compositeHMu,
    randomGuessing: perComponent[0].randomGuessing,
  };
}
