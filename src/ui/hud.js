const hudPoints = document.getElementById('hud-points');
const hudRange = document.getElementById('hud-range');
const hudCompute = document.getElementById('hud-compute');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const measureLabel = document.getElementById('hover-measure-label');

export function updatePoints(n) {
  hudPoints.textContent = n.toLocaleString();
}

export function updateRange(min, max, unit) {
  hudRange.textContent = `${min.toFixed(3)}\u2013${max.toFixed(3)}`;
}

export function updateCompute(ms) {
  if (typeof ms === 'string') {
    hudCompute.textContent = ms;
  } else {
    hudCompute.textContent = `${ms.toFixed(0)}ms`;
  }
}

export function showProgress() {
  progressBar.style.display = '';
  progressFill.style.width = '0%';
}

export function updateProgress(fraction) {
  progressFill.style.width = (fraction * 100).toFixed(1) + '%';
}

export function hideProgress() {
  progressBar.style.display = 'none';
}

export function setMeasureLabel(label) {
  measureLabel.textContent = label;
}
