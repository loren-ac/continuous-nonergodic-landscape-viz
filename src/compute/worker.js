// Web Worker for expensive Monte Carlo measures
// Self-contained: imports only prng.js, inlines process math

import { createRng, nextFloat, sampleCategorical } from './prng.js';

// --- Inline Mess3 transition matrix (cannot use import map in workers) ---

function mess3TransitionMatrix(x, a) {
  const b = (1 - a) / 2;
  const y = 1 - 2 * x;
  const ay = a * y, bx = b * x, by = b * y, ax = a * x;
  return [
    ay, bx, bx, ax, by, bx, ax, bx, by,  // obs=0
    by, ax, bx, bx, ay, bx, bx, ax, by,  // obs=1
    by, bx, ax, bx, by, ax, bx, bx, ay,  // obs=2
  ];
}

function mess3EmissionProbs(tm) {
  // P(obs|state) = sum_j T[obs][s][j], V=3, S=3
  const emit = new Float64Array(9); // [obs*3 + state]
  for (let s = 0; s < 3; s++) {
    for (let o = 0; o < 3; o++) {
      let p = 0;
      for (let j = 0; j < 3; j++) p += tm[o * 9 + s * 3 + j];
      emit[o * 3 + s] = p;
    }
  }
  return emit;
}

function mess3EntropyRate(x, a) {
  const emit = mess3EmissionProbs(mess3TransitionMatrix(x, a));
  let H = 0;
  for (let s = 0; s < 3; s++) {
    for (let o = 0; o < 3; o++) {
      const p = emit[o * 3 + s];
      if (p > 1e-15) H -= (1 / 3) * p * Math.log(p);
    }
  }
  return H;
}

// --- Forward algorithm step ---

// Run forward algorithm on a sequence, return average -log P(obs|belief) per position
function forwardLoss(tm, emit, sequence, contextLength) {
  const belief = new Float64Array([1 / 3, 1 / 3, 1 / 3]);
  let totalLoss = 0;

  for (let t = 0; t < contextLength; t++) {
    const obs = sequence[t];

    // Predictive probability
    let predProb = 0;
    for (let s = 0; s < 3; s++) predProb += belief[s] * emit[obs * 3 + s];
    totalLoss += -Math.log(predProb + 1e-15);

    // Belief update: belief'[s'] = sum_s belief[s] * T[obs][s][s']
    const newBelief = new Float64Array(3);
    for (let sp = 0; sp < 3; sp++) {
      for (let s = 0; s < 3; s++) {
        newBelief[sp] += belief[s] * tm[obs * 9 + s * 3 + sp];
      }
    }
    // Normalize
    let norm = newBelief[0] + newBelief[1] + newBelief[2];
    if (norm > 0) {
      belief[0] = newBelief[0] / norm;
      belief[1] = newBelief[1] / norm;
      belief[2] = newBelief[2] / norm;
    }
  }

  return totalLoss / contextLength;
}

// Generate a sequence and return average entropy of predictive distribution (Estimator 2)
function generateAndScoreEntropy(tm, emit, contextLength, rng) {
  const belief = new Float64Array([1 / 3, 1 / 3, 1 / 3]);
  let totalEntropy = 0;

  for (let t = 0; t < contextLength; t++) {
    const pred = new Float64Array(3);
    for (let o = 0; o < 3; o++) {
      for (let s = 0; s < 3; s++) pred[o] += belief[s] * emit[o * 3 + s];
    }

    // Entropy of predictive distribution
    let h = 0;
    for (let o = 0; o < 3; o++) {
      if (pred[o] > 1e-15) h -= pred[o] * Math.log(pred[o]);
    }
    totalEntropy += h;

    // Sample observation
    const obs = sampleCategorical(rng, pred, 3);

    // Belief update
    const newBelief = new Float64Array(3);
    for (let sp = 0; sp < 3; sp++) {
      for (let s = 0; s < 3; s++) {
        newBelief[sp] += belief[s] * tm[obs * 9 + s * 3 + sp];
      }
    }
    let norm = newBelief[0] + newBelief[1] + newBelief[2];
    if (norm > 0) {
      belief[0] = newBelief[0] / norm;
      belief[1] = newBelief[1] / norm;
      belief[2] = newBelief[2] / norm;
    }
  }

  return totalEntropy / contextLength;
}

// --- Measure implementations ---

function computeOptimalLoss(params, resolution, measureParams, progressCb) {
  const { contextLength, batchSize, seed } = measureParams;
  const xMin = params.xMin, xMax = params.xMax;
  const aMin = params.aMin, aMax = params.aMax;
  const nx = resolution, ny = resolution;
  const N = nx * ny;
  const values = new Float32Array(N);
  const variances = new Float32Array(N);
  const gridParams = new Float64Array(N * 2);
  let vMin = Infinity, vMax = -Infinity;
  const progressInterval = Math.max(1, Math.floor(N / 100));

  for (let iy = 0; iy < ny; iy++) {
    const a = aMin + (iy / (ny - 1)) * (aMax - aMin);
    for (let ix = 0; ix < nx; ix++) {
      const x = xMin + (ix / (nx - 1)) * (xMax - xMin);
      const idx = iy * nx + ix;
      gridParams[idx * 2] = x;
      gridParams[idx * 2 + 1] = a;

      const tm = mess3TransitionMatrix(x, a);
      const emit = mess3EmissionProbs(tm);
      const rng = createRng((seed + idx * 2654435761) | 0);

      let totalLoss = 0;
      let sumSq = 0;
      for (let b = 0; b < batchSize; b++) {
        const loss = generateAndScoreEntropy(tm, emit, contextLength, rng);
        totalLoss += loss;
        sumSq += loss * loss;
      }
      const mean = totalLoss / batchSize;
      values[idx] = mean;
      variances[idx] = Math.max(0, sumSq / batchSize - mean * mean);
      if (mean < vMin) vMin = mean;
      if (mean > vMax) vMax = mean;

      if (idx % progressInterval === 0) progressCb(idx / N);
    }
  }

  return { values, variances, params: gridParams, N, nx, ny, vMin, vMax };
}

function computeEntropyRateEstimate(params, resolution, measureParams, progressCb) {
  const { contextLength, batchSize, seed } = measureParams;
  const xMin = params.xMin, xMax = params.xMax;
  const aMin = params.aMin, aMax = params.aMax;
  const nx = resolution, ny = resolution;
  const N = nx * ny;
  const values = new Float32Array(N);
  const variances = new Float32Array(N);
  const gridParams = new Float64Array(N * 2);
  let vMin = Infinity, vMax = -Infinity;
  const progressInterval = Math.max(1, Math.floor(N / 100));
  const tailStart = Math.floor(contextLength * 0.8);

  for (let iy = 0; iy < ny; iy++) {
    const a = aMin + (iy / (ny - 1)) * (aMax - aMin);
    for (let ix = 0; ix < nx; ix++) {
      const x = xMin + (ix / (nx - 1)) * (xMax - xMin);
      const idx = iy * nx + ix;
      gridParams[idx * 2] = x;
      gridParams[idx * 2 + 1] = a;

      const tm = mess3TransitionMatrix(x, a);
      const emit = mess3EmissionProbs(tm);
      const rng = createRng((seed + idx * 2654435761) | 0);

      // Per-position entropy accumulator
      const entropies = new Float64Array(contextLength);

      for (let b = 0; b < batchSize; b++) {
        const belief = new Float64Array([1 / 3, 1 / 3, 1 / 3]);

        for (let t = 0; t < contextLength; t++) {
          const pred = new Float64Array(3);
          for (let o = 0; o < 3; o++)
            for (let s = 0; s < 3; s++) pred[o] += belief[s] * emit[o * 3 + s];

          let h = 0;
          for (let o = 0; o < 3; o++)
            if (pred[o] > 1e-15) h -= pred[o] * Math.log(pred[o]);
          entropies[t] += h;

          const obs = sampleCategorical(rng, pred, 3);
          const newBelief = new Float64Array(3);
          for (let sp = 0; sp < 3; sp++)
            for (let s = 0; s < 3; s++)
              newBelief[sp] += belief[s] * tm[obs * 9 + s * 3 + sp];
          let norm = newBelief[0] + newBelief[1] + newBelief[2];
          if (norm > 0) {
            belief[0] = newBelief[0] / norm;
            belief[1] = newBelief[1] / norm;
            belief[2] = newBelief[2] / norm;
          }
        }
      }

      // Average over batch, then tail-average last 20% for ĥ_μ
      let tailSum = 0;
      let sumSq = 0;
      for (let t = tailStart; t < contextLength; t++) {
        entropies[t] /= batchSize;
        tailSum += entropies[t];
      }
      const mean = tailSum / (contextLength - tailStart);
      values[idx] = mean;

      // Variance: use per-sequence tail-averaged values
      // Re-run not needed — use batch variance of context-averaged entropies
      // Approximate: use variance of the per-position tail entropies as proxy
      for (let t = tailStart; t < contextLength; t++) {
        const diff = entropies[t] - mean;
        sumSq += diff * diff;
      }
      variances[idx] = sumSq / (contextLength - tailStart);

      if (mean < vMin) vMin = mean;
      if (mean > vMax) vMax = mean;

      if (idx % progressInterval === 0) progressCb(idx / N);
    }
  }

  return { values, variances, params: gridParams, N, nx, ny, vMin, vMax };
}

function computeProcessKLRate(params, resolution, measureParams, progressCb) {
  const { contextLength, batchSize, seed, refX, refA } = measureParams;
  const xMin = params.xMin, xMax = params.xMax;
  const aMin = params.aMin, aMax = params.aMax;
  const nx = resolution, ny = resolution;
  const N = nx * ny;
  const values = new Float32Array(N);
  const variances = new Float32Array(N);
  const gridParams = new Float64Array(N * 2);
  let vMin = Infinity, vMax = -Infinity;
  const progressInterval = Math.max(1, Math.floor(N / 100));

  // Generate reference sequences once
  const refTm = mess3TransitionMatrix(refX, refA);
  const refEmit = mess3EmissionProbs(refTm);
  const refEntropyRate = mess3EntropyRate(refX, refA);
  const refRng = createRng(seed);
  const sequences = [];

  for (let b = 0; b < batchSize; b++) {
    const seq = new Uint8Array(contextLength);
    const belief = new Float64Array([1 / 3, 1 / 3, 1 / 3]);
    for (let t = 0; t < contextLength; t++) {
      const pred = new Float64Array(3);
      for (let o = 0; o < 3; o++) {
        for (let s = 0; s < 3; s++) pred[o] += belief[s] * refEmit[o * 3 + s];
      }
      const obs = sampleCategorical(refRng, pred, 3);
      seq[t] = obs;
      // Update belief with reference model
      const newBelief = new Float64Array(3);
      for (let sp = 0; sp < 3; sp++) {
        for (let s = 0; s < 3; s++) {
          newBelief[sp] += belief[s] * refTm[obs * 9 + s * 3 + sp];
        }
      }
      let norm = newBelief[0] + newBelief[1] + newBelief[2];
      if (norm > 0) {
        belief[0] = newBelief[0] / norm;
        belief[1] = newBelief[1] / norm;
        belief[2] = newBelief[2] / norm;
      }
    }
    sequences.push(seq);
  }

  // For each grid point, run target forward algorithm on reference sequences
  for (let iy = 0; iy < ny; iy++) {
    const a = aMin + (iy / (ny - 1)) * (aMax - aMin);
    for (let ix = 0; ix < nx; ix++) {
      const x = xMin + (ix / (nx - 1)) * (xMax - xMin);
      const idx = iy * nx + ix;
      gridParams[idx * 2] = x;
      gridParams[idx * 2 + 1] = a;

      const tm = mess3TransitionMatrix(x, a);
      const emit = mess3EmissionProbs(tm);

      let totalCE = 0;
      let sumSqCE = 0;
      for (let b = 0; b < batchSize; b++) {
        const ce = forwardLoss(tm, emit, sequences[b], contextLength);
        totalCE += ce;
        sumSqCE += ce * ce;
      }
      const crossEntropy = totalCE / batchSize;
      const v = Math.max(0, crossEntropy - refEntropyRate);
      values[idx] = v;
      variances[idx] = Math.max(0, sumSqCE / batchSize - crossEntropy * crossEntropy);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;

      if (idx % progressInterval === 0) progressCb(idx / N);
    }
  }

  return { values, variances, params: gridParams, N, nx, ny, vMin, vMax };
}

function computeProcessFisherRate(params, resolution, measureParams, progressCb) {
  const { contextLength, batchSize, seed } = measureParams;
  const xMin = params.xMin, xMax = params.xMax;
  const aMin = params.aMin, aMax = params.aMax;
  const nx = resolution, ny = resolution;
  const N = nx * ny;
  const values = new Float32Array(N);
  const variances = new Float32Array(N);
  const gridParams = new Float64Array(N * 2);
  let vMin = Infinity, vMax = -Infinity;
  const progressInterval = Math.max(1, Math.floor(N / 100));
  const eps = 1e-4;

  for (let iy = 0; iy < ny; iy++) {
    const a = aMin + (iy / (ny - 1)) * (aMax - aMin);
    for (let ix = 0; ix < nx; ix++) {
      const x = xMin + (ix / (nx - 1)) * (xMax - xMin);
      const idx = iy * nx + ix;
      gridParams[idx * 2] = x;
      gridParams[idx * 2 + 1] = a;

      // Generate sequences from the process at (x, a)
      const tm = mess3TransitionMatrix(x, a);
      const emit = mess3EmissionProbs(tm);
      const rng = createRng((seed + idx * 2654435761) | 0);
      const sequences = [];
      for (let b = 0; b < batchSize; b++) {
        const seq = new Uint8Array(contextLength);
        const belief = new Float64Array([1 / 3, 1 / 3, 1 / 3]);
        for (let t = 0; t < contextLength; t++) {
          const pred = new Float64Array(3);
          for (let o = 0; o < 3; o++) {
            for (let s = 0; s < 3; s++) pred[o] += belief[s] * emit[o * 3 + s];
          }
          seq[t] = sampleCategorical(rng, pred, 3);
          const newBelief = new Float64Array(3);
          for (let sp = 0; sp < 3; sp++) {
            for (let s = 0; s < 3; s++) {
              newBelief[sp] += belief[s] * tm[seq[t] * 9 + s * 3 + sp];
            }
          }
          let norm = newBelief[0] + newBelief[1] + newBelief[2];
          if (norm > 0) {
            belief[0] = newBelief[0] / norm;
            belief[1] = newBelief[1] / norm;
            belief[2] = newBelief[2] / norm;
          }
        }
        sequences.push(seq);
      }

      // Perturbed models
      const xLo = Math.max(xMin, x - eps);
      const xHi = Math.min(xMax, x + eps);
      const aLo = Math.max(aMin, a - eps);
      const aHi = Math.min(aMax, a + eps);

      const tmXp = mess3TransitionMatrix(xHi, a);
      const emXp = mess3EmissionProbs(tmXp);
      const tmXm = mess3TransitionMatrix(xLo, a);
      const emXm = mess3EmissionProbs(tmXm);
      const tmAp = mess3TransitionMatrix(x, aHi);
      const emAp = mess3EmissionProbs(tmAp);
      const tmAm = mess3TransitionMatrix(x, aLo);
      const emAm = mess3EmissionProbs(tmAm);

      const dxInv = 1 / (xHi - xLo);
      const daInv = 1 / (aHi - aLo);

      // Compute score functions and accumulate FIM
      let fim00 = 0, fim11 = 0;
      let sumSeqFisher = 0, sumSqSeqFisher = 0;
      for (let b = 0; b < batchSize; b++) {
        const seq = sequences[b];

        // Per-position log-probs at all 5 parameter settings
        const logPXp = perPositionLogProbs(tmXp, emXp, seq, contextLength);
        const logPXm = perPositionLogProbs(tmXm, emXm, seq, contextLength);
        const logPAp = perPositionLogProbs(tmAp, emAp, seq, contextLength);
        const logPAm = perPositionLogProbs(tmAm, emAm, seq, contextLength);

        let seqFim = 0;
        for (let t = 0; t < contextLength; t++) {
          const scoreX = (logPXp[t] - logPXm[t]) * dxInv;
          const scoreA = (logPAp[t] - logPAm[t]) * daInv;
          fim00 += scoreX * scoreX;
          fim11 += scoreA * scoreA;
          seqFim += scoreX * scoreX + scoreA * scoreA;
        }
        const seqVal = seqFim / contextLength;
        sumSeqFisher += seqVal;
        sumSqSeqFisher += seqVal * seqVal;
      }

      const total = batchSize * contextLength;
      const v = (fim00 + fim11) / total; // trace(FIM_rate)
      values[idx] = v;
      const meanSeq = sumSeqFisher / batchSize;
      variances[idx] = Math.max(0, sumSqSeqFisher / batchSize - meanSeq * meanSeq);
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;

      if (idx % progressInterval === 0) progressCb(idx / N);
    }
  }

  return { values, variances, params: gridParams, N, nx, ny, vMin, vMax };
}

// Per-position log P(obs_t | belief_t) for a given sequence under a given model
function perPositionLogProbs(tm, emit, sequence, contextLength) {
  const logProbs = new Float64Array(contextLength);
  const belief = new Float64Array([1 / 3, 1 / 3, 1 / 3]);

  for (let t = 0; t < contextLength; t++) {
    const obs = sequence[t];
    let predProb = 0;
    for (let s = 0; s < 3; s++) predProb += belief[s] * emit[obs * 3 + s];
    logProbs[t] = Math.log(predProb + 1e-15);

    const newBelief = new Float64Array(3);
    for (let sp = 0; sp < 3; sp++) {
      for (let s = 0; s < 3; s++) {
        newBelief[sp] += belief[s] * tm[obs * 9 + s * 3 + sp];
      }
    }
    let norm = newBelief[0] + newBelief[1] + newBelief[2];
    if (norm > 0) {
      belief[0] = newBelief[0] / norm;
      belief[1] = newBelief[1] / norm;
      belief[2] = newBelief[2] / norm;
    }
  }

  return logProbs;
}

// --- Process param bounds (must match mess3.js) ---

const PROCESS_PARAMS = {
  mess3: { xMin: 0.01, xMax: 0.5, aMin: 0.01, aMax: 1.0 },
};

// --- Worker message handling ---

let cancelled = false;

self.onmessage = function (e) {
  const { type, id, payload } = e.data;

  if (type === 'cancel') {
    cancelled = true;
    return;
  }

  if (type === 'compute') {
    cancelled = false;
    const { processName, measureName, resolution, measureParams } = payload;
    const params = PROCESS_PARAMS[processName];

    if (!params) {
      self.postMessage({ type: 'error', id, message: `Unknown process: ${processName}` });
      return;
    }

    const progressCb = (fraction) => {
      if (cancelled) throw new Error('cancelled');
      self.postMessage({ type: 'progress', id, fraction });
    };

    try {
      let result;
      switch (measureName) {
        case 'optimalLoss':
          result = computeOptimalLoss(params, resolution, measureParams, progressCb);
          break;
        case 'entropyRateEstimate':
          result = computeEntropyRateEstimate(params, resolution, measureParams, progressCb);
          break;
        case 'processKLRate':
          result = computeProcessKLRate(params, resolution, measureParams, progressCb);
          break;
        case 'processFisherRate':
          result = computeProcessFisherRate(params, resolution, measureParams, progressCb);
          break;
        default:
          self.postMessage({ type: 'error', id, message: `Unknown measure: ${measureName}` });
          return;
      }

      const transfers = [result.values.buffer, result.params.buffer];
      if (result.variances) transfers.push(result.variances.buffer);
      self.postMessage(
        { type: 'result', id, payload: result },
        transfers
      );
    } catch (err) {
      if (err.message === 'cancelled') {
        self.postMessage({ type: 'cancelled', id });
      } else {
        self.postMessage({ type: 'error', id, message: err.message });
      }
    }
  }
};
