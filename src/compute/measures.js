const measures = new Map();

// --- Helpers ---

// Compute emission probabilities P(obs|state) from a flat transition matrix
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

// --- Analytical (fast) measures ---

measures.set('entropyRate', {
  name: 'entropyRate',
  label: 'Emission Entropy',
  shortLabel: 'H(O|S)',
  unit: 'nats',
  tooltip: 'H(O|S) = \u2212\u2211\u209b \u03C0(s) \u2211\u2092 P(o|s) log P(o|s)\nWeighted average emission entropy across hidden states.',
  isExpensive: false,
  needsReference: false,
  extraParams: [],
  compute(process, paramValues) {
    return process.entropyRate(...paramValues);
  },
});

measures.set('emissionKL', {
  name: 'emissionKL',
  label: 'Emission KL',
  shortLabel: 'eKL',
  unit: 'nats',
  tooltip: 'D_KL = \u2211\u209b \u03C0(s) \u2211\u2092 P_ref(o|s) log[P_ref(o|s) / P(o|s)]\nKL divergence of emission distributions from reference.',
  isExpensive: false,
  needsReference: true,
  extraParams: [],
  compute(process, paramValues, options) {
    const V = process.vocabSize;
    const S = process.numStates;
    const piS = 1 / S;

    const tmRef = process.transitionMatrix(options.refX, options.refA);
    const tmTarget = process.transitionMatrix(paramValues[0], paramValues[1]);
    const pRef = emissionProbs(tmRef, V, S);
    const pTarget = emissionProbs(tmTarget, V, S);

    let kl = 0;
    for (let s = 0; s < S; s++) {
      for (let o = 0; o < V; o++) {
        const idx = o * S + s;
        const pr = pRef[idx];
        const pt = pTarget[idx];
        if (pr > 1e-15 && pt > 1e-15) {
          kl += piS * pr * Math.log(pr / pt);
        }
      }
    }
    return kl;
  },
});

measures.set('emissionFisher', {
  name: 'emissionFisher',
  label: 'Emission Fisher',
  shortLabel: 'eFI',
  unit: '',
  tooltip: 'Tr(F) = F\u2080\u2080 + F\u2081\u2081\nF\u1D62\u2C7C = \u2211\u209b \u03C0(s) \u2211\u2092 (1/P) \u00B7 (\u2202P/\u2202\u03B8\u1D62)(\u2202P/\u2202\u03B8\u2C7C)\nTrace of emission Fisher information w.r.t. (x, \u03B1).',
  isExpensive: false,
  needsReference: false,
  extraParams: [],
  compute(process, paramValues) {
    const { fim00, fim11 } = emissionFIM(process, paramValues[0], paramValues[1]);
    return fim00 + fim11; // trace(FIM)
  },
});

// Compute the full 2x2 emission FIM at a point (helper for Fisher-Rao)
function emissionFIM(process, x, a) {
  const V = process.vocabSize;
  const S = process.numStates;
  const piS = 1 / S;
  const eps = 1e-5;

  const p0 = emissionProbs(process.transitionMatrix(x, a), V, S);

  const xLo = Math.max(process.params[0].min, x - eps);
  const xHi = Math.min(process.params[0].max, x + eps);
  const aLo = Math.max(process.params[1].min, a - eps);
  const aHi = Math.min(process.params[1].max, a + eps);

  const pXp = emissionProbs(process.transitionMatrix(xHi, a), V, S);
  const pXm = emissionProbs(process.transitionMatrix(xLo, a), V, S);
  const pAp = emissionProbs(process.transitionMatrix(x, aHi), V, S);
  const pAm = emissionProbs(process.transitionMatrix(x, aLo), V, S);

  const dX = 1 / (xHi - xLo);
  const dA = 1 / (aHi - aLo);

  let fim00 = 0, fim01 = 0, fim11 = 0;
  for (let s = 0; s < S; s++) {
    for (let o = 0; o < V; o++) {
      const idx = o * S + s;
      const p = p0[idx];
      if (p < 1e-15) continue;
      const dpDx = (pXp[idx] - pXm[idx]) * dX;
      const dpDa = (pAp[idx] - pAm[idx]) * dA;
      const invP = 1 / p;
      fim00 += piS * invP * dpDx * dpDx;
      fim01 += piS * invP * dpDx * dpDa;
      fim11 += piS * invP * dpDa * dpDa;
    }
  }

  return { fim00, fim01, fim11 };
}

measures.set('fisherRao', {
  name: 'fisherRao',
  label: 'Fisher-Rao Distance',
  shortLabel: 'FR',
  unit: '',
  tooltip: 'd_FR = \u222B\u2080\u00B9 \u221A(\u0394\u03B8\u1D40 F(\u03B3(t)) \u0394\u03B8) dt\nGeodesic distance from reference under emission Fisher metric.',
  isExpensive: false,
  needsReference: true,
  extraParams: [],
  compute(process, paramValues, options) {
    const x1 = options.refX, a1 = options.refA;
    const x2 = paramValues[0], a2 = paramValues[1];
    const dx = x2 - x1, da = a2 - a1;

    // If ref and target are the same point, distance is 0
    if (Math.abs(dx) < 1e-12 && Math.abs(da) < 1e-12) return 0;

    // Numerical integration via trapezoidal rule along straight-line path
    const N_STEPS = 20;
    let integral = 0;

    for (let i = 0; i <= N_STEPS; i++) {
      const t = i / N_STEPS;
      const xi = x1 + t * dx;
      const ai = a1 + t * da;
      const { fim00, fim01, fim11 } = emissionFIM(process, xi, ai);

      // Δθᵀ · FIM · Δθ = fim00*dx² + 2*fim01*dx*da + fim11*da²
      const quadForm = fim00 * dx * dx + 2 * fim01 * dx * da + fim11 * da * da;
      const integrand = Math.sqrt(Math.max(0, quadForm));

      // Trapezoidal weight
      const w = (i === 0 || i === N_STEPS) ? 0.5 : 1.0;
      integral += w * integrand;
    }

    return integral / N_STEPS;
  },
});

// --- Expensive (Web Worker) measures ---

measures.set('optimalLoss', {
  name: 'optimalLoss',
  label: 'Optimal Loss',
  shortLabel: 'L*',
  unit: 'nats',
  tooltip: 'L* = \uD835\uDD3C[ (1/T) \u2211\u209C \u2212log P(o\u209C | belief\u209C) ]\nAverage per-token loss under Bayes-optimal prediction.',
  isExpensive: true,
  needsReference: false,
  extraParams: [
    { name: 'contextLength', label: 'Ctx', min: 4, max: 128, step: 4, default: 32 },
    { name: 'batchSize', label: 'Batch', min: 8, max: 256, step: 8, default: 64 },
    { name: 'seed', label: 'Seed', min: 1, max: 9999, step: 1, default: 42 },
  ],
  compute: null,
});

measures.set('entropyRateEstimate', {
  name: 'entropyRateEstimate',
  label: 'Entropy Rate (\u0125\u03BC)',
  shortLabel: '\u0125\u03BC',
  unit: 'nats',
  tooltip: '\u0125\u03BC = (1/T\u2032) \u2211_{t>0.8T} H(P(o\u209C | belief\u209C))\nTail-averaged predictive entropy (last 20% of context).',
  isExpensive: true,
  needsReference: false,
  extraParams: [
    { name: 'contextLength', label: 'Ctx', min: 64, max: 1024, step: 64, default: 512 },
    { name: 'batchSize', label: 'Batch', min: 4, max: 64, step: 4, default: 16 },
    { name: 'seed', label: 'Seed', min: 1, max: 9999, step: 1, default: 42 },
  ],
  compute: null,
});

measures.set('processKLRate', {
  name: 'processKLRate',
  label: 'Process KL Rate',
  shortLabel: 'pKL',
  unit: 'nats',
  tooltip: 'D_KL = \uD835\uDD3C_{seq\u223Cref}[ CE(target | seq) ] \u2212 H(ref)\nExcess nats/token when target predicts reference sequences.',
  isExpensive: true,
  needsReference: true,
  extraParams: [
    { name: 'contextLength', label: 'Ctx', min: 4, max: 128, step: 4, default: 32 },
    { name: 'batchSize', label: 'Batch', min: 8, max: 256, step: 8, default: 64 },
    { name: 'seed', label: 'Seed', min: 1, max: 9999, step: 1, default: 42 },
  ],
  compute: null,
});

measures.set('processFisherRate', {
  name: 'processFisherRate',
  label: 'Process Fisher Rate',
  shortLabel: 'pFI',
  unit: '',
  tooltip: '(1/T) Tr(F_process)\nProcess-level Fisher information via score function\nfinite differences.',
  isExpensive: true,
  needsReference: false,
  extraParams: [
    { name: 'contextLength', label: 'Ctx', min: 4, max: 128, step: 4, default: 32 },
    { name: 'batchSize', label: 'Batch', min: 8, max: 256, step: 8, default: 64 },
    { name: 'seed', label: 'Seed', min: 1, max: 9999, step: 1, default: 42 },
  ],
  compute: null,
});

// --- Registry API ---

export function getMeasure(name) {
  const m = measures.get(name);
  if (!m) throw new Error(`Unknown measure: ${name}`);
  return m;
}

export function getMeasureTooltips() {
  const map = {};
  for (const [name, m] of measures) {
    if (m.tooltip) map[name] = m.tooltip;
  }
  return map;
}

export function listMeasures() {
  return Array.from(measures.values()).map(m => ({
    name: m.name,
    label: m.label,
    shortLabel: m.shortLabel,
    isExpensive: m.isExpensive,
    needsReference: m.needsReference,
    extraParams: m.extraParams || [],
  }));
}
