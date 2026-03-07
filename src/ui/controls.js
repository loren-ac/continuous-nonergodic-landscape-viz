import { CustomSelect } from './custom-select.js';
import { getMeasureTooltips } from '../compute/measures.js';

// Drag-to-scrub parameter cell
export function initParamCell(el, onChange) {
  const valueEl = el.querySelector('.param-value');
  const min = parseFloat(el.dataset.min);
  const max = parseFloat(el.dataset.max);
  const step = parseFloat(el.dataset.step);
  let value = parseFloat(el.dataset.value);
  let dragging = false;
  let startX = 0;
  let startValue = 0;

  function format(v) {
    return step >= 1 ? String(Math.round(v)) : v.toFixed(1);
  }

  function set(v) {
    value = Math.round(Math.max(min, Math.min(max, v)) / step) * step;
    el.dataset.value = value;
    valueEl.textContent = format(value);
  }

  el.addEventListener('mousedown', (e) => {
    if (e.detail === 2) return; // let dblclick handle it
    dragging = true;
    startX = e.clientX;
    startValue = value;
    el.classList.add('editing');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const range = max - min;
    const sensitivity = range / 200; // full range over 200px drag
    set(startValue + dx * sensitivity);
    onChange(value);
  });

  window.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      el.classList.remove('editing');
    }
  });

  // Double-click to type value directly
  el.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = format(value);
    input.style.cssText = `
      width: 40px; background: transparent; border: none;
      border-bottom: 1px solid var(--accent); color: var(--accent);
      font-family: inherit; font-size: 12px; text-align: right;
      outline: none; padding: 0;
    `;
    valueEl.textContent = '';
    valueEl.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const parsed = parseFloat(input.value);
      if (!isNaN(parsed)) {
        set(parsed);
        onChange(value);
      }
      valueEl.textContent = format(value);
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.blur(); }
      if (e.key === 'Escape') { valueEl.textContent = format(value); }
    });
  });
}

// Create a param cell element dynamically from a spec (returns element, does not append)
function createParamCellElement(spec, onChange) {
  const el = document.createElement('div');
  el.className = 'param-cell';
  el.dataset.min = spec.min;
  el.dataset.max = spec.max;
  el.dataset.step = spec.step;
  el.dataset.value = spec.default;
  el.innerHTML = `<span class="param-label">${spec.label}</span><span class="param-value">${
    spec.step >= 1 ? String(Math.round(spec.default)) : spec.default.toFixed(1)
  }</span>`;
  initParamCell(el, (v) => onChange(spec.name, spec.step >= 1 ? Math.round(v) : v));
  return el;
}

export function initControls(callbacks) {
  const {
    onResolutionChange,
    onColormapChange,
    onHeightToggle,
    onHeightScaleChange,
    onPointSizeChange,
    onCameraPreset,
    onThemeToggle,
    onMeasureChange,
    onMeasureParamChange,
    onReferenceClear,
    onVarianceToggle,
  } = callbacks;

  // Measure select (custom dropdown)
  const measureSelect = new CustomSelect(
    document.getElementById('measure-select'),
    (value) => onMeasureChange(value),
  );
  measureSelect.setTooltips(getMeasureTooltips());

  // Process select (custom dropdown)
  new CustomSelect(
    document.getElementById('process-select'),
    () => {}, // Only one process for now
  );

  // Colormap segmented buttons
  const colormapGroup = document.getElementById('colormap-group');
  colormapGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn[data-colormap]');
    if (!btn) return;
    colormapGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onColormapChange(btn.dataset.colormap);
  });

  // Camera preset segmented buttons
  const cameraGroup = document.getElementById('camera-presets');
  cameraGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn[data-preset]');
    if (!btn) return;
    cameraGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onCameraPreset(btn.dataset.preset);
  });

  // Parameter cells
  initParamCell(document.getElementById('param-resolution'), (v) => {
    onResolutionChange(Math.round(v));
  });

  initParamCell(document.getElementById('param-pointsize'), (v) => {
    onPointSizeChange(v);
  });

  const heightScaleCell = document.getElementById('param-heightscale');
  initParamCell(heightScaleCell, (v) => {
    onHeightScaleChange(v);
  });

  // Height toggle
  const heightBtn = document.getElementById('height-toggle');
  let heightOn = false;
  heightBtn.addEventListener('click', () => {
    heightOn = !heightOn;
    heightBtn.classList.toggle('active', heightOn);
    heightScaleCell.style.display = heightOn ? '' : 'none';
    onHeightToggle(heightOn);
  });

  // Variance toggle
  const varBtn = document.getElementById('var-toggle');
  let varOn = false;
  varBtn.addEventListener('click', () => {
    varOn = !varOn;
    varBtn.classList.toggle('active', varOn);
    if (onVarianceToggle) onVarianceToggle(varOn);
  });

  // Theme toggle
  const themeBtn = document.getElementById('theme-toggle');
  themeBtn.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    document.documentElement.setAttribute('data-theme', isLight ? '' : 'light');
    onThemeToggle(!isLight);
  });

  // Reference point clear button
  const refClearBtn = document.getElementById('ref-clear');
  refClearBtn.addEventListener('click', () => {
    onReferenceClear();
  });

  // Help dropdown
  const helpDropdown = document.getElementById('help-dropdown');
  const helpTrigger = document.getElementById('help-trigger');
  const helpMenu = document.getElementById('help-menu');

  helpMenu.innerHTML = `
    <div class="help-row"><span class="help-key">Click</span><span class="help-desc">Explore point</span></div>
    <div class="help-row"><span class="help-key">Shift + Click</span><span class="help-desc">Add/remove mix component</span></div>
    <div class="help-row"><span class="help-key">Cmd + Click</span><span class="help-desc">New mix tab</span></div>
    <div class="help-divider"></div>
    <div class="help-row"><span class="help-key">Option + Drag</span><span class="help-desc">Move marker</span></div>
    <div class="help-row"><span class="help-key">Opt + Shift + Drag</span><span class="help-desc">Constrain to axis</span></div>
    <div class="help-row"><span class="help-key">Double-click value</span><span class="help-desc">Type exact coordinate</span></div>
  `;

  helpTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    helpDropdown.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!helpDropdown.contains(e.target)) {
      helpDropdown.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') helpDropdown.classList.remove('open');
  });
}

// Update measure-specific parameter cells dynamically
export function updateMeasureParams(extraParams, onMeasureParamChange) {
  const container = document.getElementById('measure-params');
  const runBtn = document.getElementById('measure-run');
  // Remove only param cells, preserve the run button
  container.querySelectorAll('.param-cell').forEach(el => el.remove());
  if (!extraParams || extraParams.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  for (const spec of extraParams) {
    // Insert before run button so it stays at the end
    const cell = createParamCellElement(spec, onMeasureParamChange);
    container.insertBefore(cell, runBtn);
  }
}

// Run/Cancel button state management
const runBtn = document.getElementById('measure-run');
let _onRunClick = null;

export function wireRunButton(onRun) {
  _onRunClick = onRun;
}

runBtn.addEventListener('click', () => {
  if (_onRunClick) _onRunClick();
});

// state: 'hidden' | 'idle' | 'dirty' | 'running'
export function setRunState(state) {
  runBtn.classList.remove('dirty', 'running');
  if (state === 'hidden') {
    runBtn.style.display = 'none';
    return;
  }
  runBtn.style.display = '';
  switch (state) {
    case 'idle':
      runBtn.textContent = '\u25B6';
      break;
    case 'dirty':
      runBtn.textContent = '\u25B6';
      runBtn.classList.add('dirty');
      break;
    case 'running':
      runBtn.textContent = '\u00D7';
      runBtn.classList.add('running');
      break;
  }
}

// Show/hide reference info section
export function showRefInfo(x, a) {
  const el = document.getElementById('ref-info');
  document.getElementById('ref-x').textContent = x.toFixed(4);
  document.getElementById('ref-a').textContent = a.toFixed(4);
  el.style.display = '';
}

export function hideRefInfo() {
  document.getElementById('ref-info').style.display = 'none';
}

// Show/hide the Var toggle depending on measure type
export function setVarToggleVisible(visible) {
  document.getElementById('var-toggle').style.display = visible ? '' : 'none';
}
