const el = document.getElementById('tooltip');
const tipX = document.getElementById('tip-x');
const tipA = document.getElementById('tip-a');
const tipH = document.getElementById('tip-h');

// Status bar hover info elements
const hoverX = document.getElementById('hover-x');
const hoverA = document.getElementById('hover-a');
const hoverH = document.getElementById('hover-h');

const tipMeasureLabel = document.getElementById('tip-measure-label');

let visible = false;

export function show(mouseX, mouseY, x, a, measure) {
  const xStr = x.toFixed(4);
  const aStr = a.toFixed(4);
  const hStr = measure != null ? measure.toFixed(4) : '\u2014';

  // Update floating tooltip
  tipX.textContent = xStr;
  tipA.textContent = aStr;
  tipH.textContent = hStr;

  // Update status bar
  hoverX.textContent = xStr;
  hoverA.textContent = aStr;
  hoverH.textContent = hStr;

  // Position tooltip offset from cursor
  const offsetX = 14;
  const offsetY = 14;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = mouseX + offsetX;
  let top = mouseY + offsetY;

  if (left + w > window.innerWidth - 8) left = mouseX - w - offsetX;
  if (top + h > window.innerHeight - 8) top = mouseY - h - offsetY;

  el.style.left = left + 'px';
  el.style.top = top + 'px';

  if (!visible) {
    el.classList.add('visible');
    visible = true;
  }
}

export function hide() {
  if (visible) {
    el.classList.remove('visible');
    visible = false;
  }
  hoverX.textContent = '\u2014';
  hoverA.textContent = '\u2014';
  hoverH.textContent = '\u2014';
}

export function setLabel(label) {
  tipMeasureLabel.textContent = label + ' ';
}
