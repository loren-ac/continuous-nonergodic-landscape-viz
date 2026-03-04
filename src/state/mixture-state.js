// Singleton state for the mixture component collection.
// Each component is a weighted delta at a (x, α) parameterization.

const components = [];
const listeners = [];

function notify() {
  for (const cb of listeners) cb(components);
}

function normalizeWeights() {
  const n = components.length;
  if (n === 0) return;
  const uniform = 1 / n;
  for (const c of components) c.weight = uniform;
}

export function getComponents() {
  return components.slice();
}

export function getCount() {
  return components.length;
}

export function isMultiDelta() {
  return components.length >= 2;
}

export function addComponent(x, a, nx, na) {
  components.push({ x, a, nx, na, weight: 0 });
  normalizeWeights();
  notify();
}

export function removeComponent(index) {
  if (index < 0 || index >= components.length) return;
  components.splice(index, 1);
  if (components.length > 0) normalizeWeights();
  notify();
}

export function updateWeight(index, weight) {
  if (index < 0 || index >= components.length) return;
  const n = components.length;
  if (n < 2) return;

  // Clamp to [0.01, 0.99] to avoid degenerate weights
  weight = Math.max(0.01, Math.min(0.99, weight));
  const oldWeight = components[index].weight;
  const otherSum = 1 - oldWeight;

  components[index].weight = weight;

  // Proportionally rescale other weights to maintain sum = 1
  const remaining = 1 - weight;
  if (otherSum > 1e-10) {
    const scale = remaining / otherSum;
    for (let i = 0; i < n; i++) {
      if (i !== index) components[i].weight *= scale;
    }
  } else {
    // Edge case: distribute equally among others
    const each = remaining / (n - 1);
    for (let i = 0; i < n; i++) {
      if (i !== index) components[i].weight = each;
    }
  }

  notify();
}

export function updatePosition(index, x, a, nx, na) {
  if (index < 0 || index >= components.length) return;
  Object.assign(components[index], { x, a, nx, na });
  notify();
}

export function clearAll() {
  components.length = 0;
  notify();
}

// Find component near a given normalized coordinate (for removal on shift+click)
export function findNear(nx, na, threshold = 0.02) {
  for (let i = 0; i < components.length; i++) {
    const dx = components[i].nx - nx;
    const da = components[i].na - na;
    if (Math.sqrt(dx * dx + da * da) < threshold) return i;
  }
  return -1;
}

export function onChange(callback) {
  listeners.push(callback);
}

export function getWeights() {
  return new Float64Array(components.map(c => c.weight));
}
