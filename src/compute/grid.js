// Grid computation over parameter space

export function computeGrid(process, measure, resolution, options = {}) {
  const [p0, p1] = process.params;
  const nx = resolution;
  const ny = resolution;
  const N = nx * ny;

  const params = new Float64Array(N * 2);
  const values = new Float32Array(N);

  let vMin = Infinity;
  let vMax = -Infinity;

  for (let iy = 0; iy < ny; iy++) {
    const a = p1.min + (iy / (ny - 1)) * (p1.max - p1.min);
    for (let ix = 0; ix < nx; ix++) {
      const x = p0.min + (ix / (nx - 1)) * (p0.max - p0.min);
      const idx = iy * nx + ix;
      params[idx * 2] = x;
      params[idx * 2 + 1] = a;
      const v = measure.compute(process, [x, a], options);
      values[idx] = v;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }

  return { params, values, N, nx, ny, vMin, vMax };
}
