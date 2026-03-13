// Measure-value Voronoi: assign each grid point to the component
// whose measure value is closest, then extract boundary edges.

/**
 * @param {object} gridData - Grid data with .values, .params, .nx, .ny, .process
 * @param {Array} components - Compound tab components [{x, a, weight, nx, na}, ...]
 * @param {boolean} heightEnabled
 * @param {number} heightScale
 * @returns {{ assignments: Uint8Array, edges: Float32Array, edgeColors: Float32Array }}
 */
export function computeMeasureVoronoi(gridData, components, heightEnabled, heightScale) {
  const { values, params, nx, ny, N, vMin, vMax } = gridData;
  const [p0, p1] = [gridData.process.params[0], gridData.process.params[1]];
  const range = vMax - vMin || 1;
  const K = components.length;

  // Find measure value at each component's nearest grid point
  const seedValues = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let i = 0; i < N; i++) {
      const dx = params[i * 2] - components[k].x;
      const da = params[i * 2 + 1] - components[k].a;
      const d = dx * dx + da * da;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    seedValues[k] = values[bestIdx];
  }

  // Assign each grid point to nearest seed by measure value
  const assignments = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    let bestK = 0;
    let bestD = Math.abs(values[i] - seedValues[0]);
    for (let k = 1; k < K; k++) {
      const d = Math.abs(values[i] - seedValues[k]);
      if (d < bestD) { bestD = d; bestK = k; }
    }
    assignments[i] = bestK;
  }

  // Detect boundary edges between adjacent differently-assigned grid points
  // Collect as list first, then pack into Float32Array
  const edgeList = [];
  const edgeColorList = [];

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const idx = iy * nx + ix;
      const a0 = assignments[idx];

      // Check right neighbor
      if (ix < nx - 1) {
        const idxR = idx + 1;
        const a1 = assignments[idxR];
        if (a0 !== a1) {
          pushEdge(edgeList, edgeColorList, gridData, idx, idxR, Math.max(a0, a1),
            p0, p1, heightEnabled, heightScale, range);
        }
      }

      // Check bottom neighbor
      if (iy < ny - 1) {
        const idxB = idx + nx;
        const a1 = assignments[idxB];
        if (a0 !== a1) {
          pushEdge(edgeList, edgeColorList, gridData, idx, idxB, Math.max(a0, a1),
            p0, p1, heightEnabled, heightScale, range);
        }
      }
    }
  }

  const edges = new Float32Array(edgeList);
  const edgeColors = new Float32Array(edgeColorList);
  return { assignments, edges, edgeColors };
}

function pushEdge(edgeList, edgeColorList, gridData, i0, i1, colorIdx,
    p0, p1, heightEnabled, heightScale, range) {
  const { params, values, vMin } = gridData;

  const x0 = (params[i0 * 2] - p0.min) / (p0.max - p0.min);
  const z0 = (params[i0 * 2 + 1] - p1.min) / (p1.max - p1.min);
  const x1 = (params[i1 * 2] - p0.min) / (p0.max - p0.min);
  const z1 = (params[i1 * 2 + 1] - p1.min) / (p1.max - p1.min);

  const y0 = heightEnabled ? ((values[i0] - vMin) / range) * heightScale * 0.5 : 0.002;
  const y1 = heightEnabled ? ((values[i1] - vMin) / range) * heightScale * 0.5 : 0.002;

  // Edge runs perpendicular to the neighbor direction, centered at midpoint
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const mz = (z0 + z1) / 2;

  // Direction from i0 to i1
  const dx = x1 - x0;
  const dz = z1 - z0;
  // Perpendicular (rotate 90°)
  const px = -dz / 2;
  const pz = dx / 2;

  edgeList.push(
    mx - px, my, mz - pz,
    mx + px, my, mz + pz,
  );

  // Parse component color for this edge
  const hex = COMPONENT_COLORS_RGB[colorIdx % COMPONENT_COLORS_RGB.length];
  edgeColorList.push(hex[0], hex[1], hex[2], hex[0], hex[1], hex[2]);
}

// Pre-parsed component colors as [r, g, b] in [0,1]
const COMPONENT_COLORS_RGB = [
  [0.91, 0.66, 0.30], // #e8a84c
  [0.30, 0.55, 0.91], // #4c8ce8
  [0.30, 0.91, 0.48], // #4ce87a
  [0.91, 0.30, 0.55], // #e84c8c
  [0.55, 0.30, 0.91], // #8c4ce8
];
