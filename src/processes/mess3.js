// Mess3 process family
// Translated from simplexity/generative_processes/transition_matrices.py:124-152

export const mess3 = {
  name: 'mess3',
  label: 'Mess3',
  vocabSize: 3,
  numStates: 3,
  params: [
    { name: 'x', label: 'x', min: 0.01, max: 0.5, default: 0.25, step: 0.01 },
    { name: 'a', label: '\u03b1', min: 0.01, max: 1.0, default: 0.6, step: 0.01 },
  ],

  // T[obs][from_state][to_state] — flat Float64Array of length 27
  transitionMatrix(x, a) {
    const b = (1 - a) / 2;
    const y = 1 - 2 * x;
    const ay = a * y, bx = b * x, by = b * y, ax = a * x;
    return new Float64Array([
      // obs = 0
      ay, bx, bx,
      ax, by, bx,
      ax, bx, by,
      // obs = 1
      by, ax, bx,
      bx, ay, bx,
      bx, ax, by,
      // obs = 2
      by, bx, ax,
      bx, by, ax,
      bx, bx, ay,
    ]);
  },

  stationaryState() {
    return new Float64Array([1 / 3, 1 / 3, 1 / 3]);
  },

  // Entropy rate: H = -sum_s pi(s) * sum_obs P(obs|s) * log(P(obs|s))
  // P(obs|s) = sum_j T[obs][s][j]
  entropyRate(x, a) {
    const b = (1 - a) / 2;
    const y = 1 - 2 * x;
    const ay = a * y, bx = b * x, by = b * y, ax = a * x;

    // Emission probs P(obs|state) = row sums per obs-state block
    // For state s, obs o: P(o|s) = sum_j T[o*9 + s*3 + j] for j=0..2
    // But since rows sum nicely, compute directly:
    const V = 3, S = 3;
    const tm = [
      ay, bx, bx, ax, by, bx, ax, bx, by,
      by, ax, bx, bx, ay, bx, bx, ax, by,
      by, bx, ax, bx, by, ax, bx, bx, ay,
    ];

    let H = 0;
    const piS = 1 / S; // uniform stationary for mess3
    for (let s = 0; s < S; s++) {
      for (let o = 0; o < V; o++) {
        let p = 0;
        for (let j = 0; j < S; j++) {
          p += tm[o * S * S + s * S + j];
        }
        if (p > 1e-15) {
          H -= piS * p * Math.log(p);
        }
      }
    }
    return H;
  },
};
