// Detail panel: shows per-position loss curve and belief simplex trajectory
// for a single (x, α) parameterization.

import { computeDetailData, estimateEntropyRate } from '../compute/detail-compute.js';
import { computeMixtureData } from '../compute/mixture-compute.js';
import { getProcess } from '../processes/registry.js';
import { initParamCell } from '../ui/controls.js';
import { componentColor } from './component-colors.js';

const LOSS_CANVAS_HEIGHT = 180;
const SIMPLEX_CANVAS_HEIGHT = 200;

let panelEl = null;
let lossCanvas = null;
let lossCtx = null;
let simplexCanvas = null;
let simplexCtx = null;
let currentData = null;
let currentPoint = null;
let processName = null;
let panelParams = { contextLength: 256, batchSize: 64, seed: 42 };
let chartToggles = {
  loss: false, optimalLoss: true, hMu: true,
  sigma: false, lbar: false, lbarStar: false, entropyRate: false, logV: true,
};
let normY = false;
let animYMin = 0, animYMax = 1;
let animFrameId = null;
let animStartTime = 0;
let animFromYMin = 0, animFromYMax = 1;
const ANIM_DURATION = 350;
let isOpen = false;
let isMinimized = false;
let _onClose = null;

// Mixture mode state
let mixtureMode = false;
let mixtureData = null;
let mixtureStateRef = null;   // reference to mixture-state module
let viewMode = 'mix';         // 'mix' or 'per'

// Per-component visibility (mixture mode)
let componentVisible = [];    // boolean[], true = visible
let soloIndex = -1;           // -1 = no solo

function resetVisibility(count) {
  componentVisible = new Array(count).fill(true);
  soloIndex = -1;
}

// Inspect mode state (transient overlay while mixture preserved)
let inspectMode = false;
let inspectPoint = null;      // { x, a }
let inspectData = null;
let _onExitInspect = null;

// Resolve CSS variable font for Canvas 2D (can't use var() in ctx.font)
function getFont(size) {
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
  return `${size}px ${family}`;
}

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function createPanel() {
  panelEl = document.createElement('div');
  panelEl.id = 'detail-panel';
  panelEl.innerHTML = `
    <div class="detail-header">
      <button class="text-toggle" id="detail-back-mix" style="display:none">&larr; Mix</button>
      <span class="detail-coords">
        <span class="info-label">x</span> <span class="info-value" id="detail-x">&mdash;</span>
        <span class="info-label">&alpha;</span> <span class="info-value" id="detail-a">&mdash;</span>
      </span>
      <span class="detail-header-btns">
        <button class="text-toggle" id="detail-minimize">&minus;</button>
        <button class="text-toggle" id="detail-close">&times;</button>
      </span>
    </div>
    <div class="detail-component-list" id="detail-component-list" style="display:none;"></div>
    <div class="detail-section">
      <div class="detail-section-label">
        Myopic Loss Convergence
        <span class="detail-chart-controls">
          <span class="detail-view-toggle" id="detail-view-toggle" style="display:none;">
            <button class="seg-btn active" data-view="mix">Mix</button>
            <button class="seg-btn" data-view="per">Per</button>
          </span>
          <div class="chart-lines-dropdown" id="chart-lines-dropdown">
            <button class="text-toggle" id="chart-lines-trigger">Lines &#9662;</button>
            <div class="chart-lines-menu" id="chart-lines-menu">
              <div class="chart-lines-item" data-key="loss"><span class="chart-lines-check"></span> L(t)</div>
              <div class="chart-lines-item" data-key="optimalLoss"><span class="chart-lines-check">&#10003;</span> L*(t)</div>
              <div class="chart-lines-item" data-key="hMu"><span class="chart-lines-check">&#10003;</span> &#x0125;<sub>&mu;</sub></div>
              <div class="chart-lines-item" data-key="sigma"><span class="chart-lines-check"></span> &plusmn;&sigma;</div>
              <div class="chart-lines-item" data-key="lbar"><span class="chart-lines-check"></span> L&#772;</div>
              <div class="chart-lines-item" data-key="lbarStar"><span class="chart-lines-check"></span> L&#772;*</div>
              <div class="chart-lines-item" data-key="entropyRate"><span class="chart-lines-check"></span> H(O|S)</div>
              <div class="chart-lines-item" data-key="logV"><span class="chart-lines-check">&#10003;</span> log V</div>
            </div>
          </div>
          <button class="text-toggle" id="norm-toggle">Norm</button>
        </span>
      </div>
      <canvas id="detail-loss-canvas"></canvas>
    </div>
    <div class="detail-section">
      <div class="detail-section-label">Belief Simplex</div>
      <canvas id="detail-simplex-canvas"></canvas>
    </div>
    <div class="detail-section detail-params">
      <div class="param-cell" id="detail-ctx" data-min="16" data-max="512" data-step="16" data-value="256">
        <span class="param-label">Ctx</span>
        <span class="param-value">256</span>
      </div>
      <div class="param-cell" id="detail-batch" data-min="8" data-max="2048" data-step="8" data-value="64">
        <span class="param-label">Batch</span>
        <span class="param-value">64</span>
      </div>
      <div class="param-cell" id="detail-seed" data-min="1" data-max="9999" data-step="1" data-value="42">
        <span class="param-label">Seed</span>
        <span class="param-value">42</span>
      </div>
    </div>
  `;
  document.body.appendChild(panelEl);

  // Tab is a separate body-level element (not inside panel, which clips overflow)
  const tabEl = document.createElement('div');
  tabEl.id = 'detail-tab';
  tabEl.className = 'detail-tab';
  tabEl.innerHTML = '&#9654;';
  document.body.appendChild(tabEl);

  lossCanvas = document.getElementById('detail-loss-canvas');
  lossCtx = lossCanvas.getContext('2d');
  simplexCanvas = document.getElementById('detail-simplex-canvas');
  simplexCtx = simplexCanvas.getContext('2d');

  document.getElementById('detail-close').addEventListener('click', () => {
    hidePanel();
    if (_onClose) _onClose();
  });

  document.getElementById('detail-minimize').addEventListener('click', () => {
    minimizePanel();
  });

  document.getElementById('detail-back-mix').addEventListener('click', () => {
    exitInspect();
    if (_onExitInspect) _onExitInspect();
  });

  tabEl.addEventListener('click', () => {
    restorePanel();
  });

  // Chart lines dropdown
  const linesTrigger = document.getElementById('chart-lines-trigger');
  const linesMenu = document.getElementById('chart-lines-menu');
  const linesDropdown = document.getElementById('chart-lines-dropdown');

  linesTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    linesDropdown.classList.toggle('open');
  });

  linesMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.chart-lines-item');
    if (!item) return;
    e.stopPropagation();
    const key = item.dataset.key;
    chartToggles[key] = !chartToggles[key];
    item.querySelector('.chart-lines-check').textContent = chartToggles[key] ? '\u2713' : '';
    renderLossChart(true);
  });

  document.addEventListener('click', (e) => {
    if (!linesDropdown.contains(e.target)) {
      linesDropdown.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      linesDropdown.classList.remove('open');
    }
  });

  // Norm button (axis scaling, separate from line toggles)
  const normBtn = document.getElementById('norm-toggle');
  normBtn.addEventListener('click', () => {
    normY = !normY;
    normBtn.classList.toggle('active', normY);
    renderLossChart(true);
  });

  // View toggle (Mix / Per)
  const viewToggle = document.getElementById('detail-view-toggle');
  viewToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    viewMode = btn.dataset.view;
    viewToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewMode));
    renderLossChart(true);
    renderSimplexChart();
  });

  initParamCell(document.getElementById('detail-ctx'), (v) => {
    panelParams.contextLength = Math.round(v);
    recomputeAndRender();
  });
  initParamCell(document.getElementById('detail-batch'), (v) => {
    panelParams.batchSize = Math.round(v);
    recomputeAndRender();
  });
  initParamCell(document.getElementById('detail-seed'), (v) => {
    panelParams.seed = Math.round(v);
    recomputeAndRender();
  });
}

export function showPanel(pName, x, a, onClose) {
  processName = pName;
  currentPoint = { x, a };
  _onClose = onClose;

  // Exit mixture and inspect mode
  mixtureMode = false;
  mixtureData = null;
  mixtureStateRef = null;
  inspectMode = false;
  inspectPoint = null;
  inspectData = null;
  document.getElementById('detail-component-list').style.display = 'none';
  document.getElementById('detail-view-toggle').style.display = 'none';
  document.getElementById('detail-back-mix').style.display = 'none';
  document.querySelector('.detail-coords').style.display = '';

  document.getElementById('detail-x').textContent = x.toFixed(4);
  document.getElementById('detail-a').textContent = a.toFixed(4);

  recomputeAndRender();

  if (isMinimized) {
    restorePanel();
  } else if (!isOpen) {
    panelEl.classList.add('open');
    document.getElementById('canvas-container').classList.add('panel-open');
    isOpen = true;
  }
}

export function showMixturePanel(pName, mixState, onClose) {
  processName = pName;
  mixtureMode = true;
  mixtureStateRef = mixState;
  _onClose = onClose;
  currentPoint = null;
  inspectMode = false;
  inspectPoint = null;
  inspectData = null;

  resetVisibility(mixState.getComponents().length);

  // Hide single coords, show component list and view toggle
  document.querySelector('.detail-coords').style.display = 'none';
  document.getElementById('detail-component-list').style.display = '';
  document.getElementById('detail-view-toggle').style.display = '';
  const backBtn = document.getElementById('detail-back-mix');
  if (backBtn) backBtn.style.display = 'none';

  renderComponentList();
  recomputeAndRender();

  if (isMinimized) {
    restorePanel();
  } else if (!isOpen) {
    panelEl.classList.add('open');
    document.getElementById('canvas-container').classList.add('panel-open');
    isOpen = true;
  }
}

export function showInspect(pName, x, a) {
  inspectMode = true;
  inspectPoint = { x, a };
  processName = pName;

  // Compute single-point data for the inspected point
  const process = getProcess(pName);
  inspectData = computeDetailData(
    process, x, a,
    panelParams.contextLength, panelParams.batchSize, panelParams.seed,
  );
  inspectData.hMu = estimateEntropyRate(process, x, a);

  // Set currentData to inspect data so chart functions render it
  currentData = inspectData;

  // Show coords header with back button, hide component list
  document.querySelector('.detail-coords').style.display = '';
  document.getElementById('detail-x').textContent = x.toFixed(4);
  document.getElementById('detail-a').textContent = a.toFixed(4);
  document.getElementById('detail-component-list').style.display = 'none';
  document.getElementById('detail-view-toggle').style.display = 'none';
  document.getElementById('detail-back-mix').style.display = '';

  // Render as single-point (temporarily suppress mixtureMode for drawing)
  const holdMixtureMode = mixtureMode;
  mixtureMode = false;
  renderLossChart(true);
  renderSimplexChart();
  mixtureMode = holdMixtureMode;

  // Ensure panel is open
  if (isMinimized) {
    restorePanel();
  } else if (!isOpen) {
    panelEl.classList.add('open');
    document.getElementById('canvas-container').classList.add('panel-open');
    isOpen = true;
  }
}

export function exitInspect() {
  if (!inspectMode) return;
  inspectMode = false;
  inspectPoint = null;
  inspectData = null;

  document.getElementById('detail-back-mix').style.display = 'none';

  // Restore mixture view
  document.querySelector('.detail-coords').style.display = 'none';
  document.getElementById('detail-component-list').style.display = '';
  document.getElementById('detail-view-toggle').style.display = '';

  renderComponentList();
  recomputeAndRender();
}

export function isInspectMode() {
  return inspectMode;
}

export function onExitInspect(cb) {
  _onExitInspect = cb;
}

function renderComponentList() {
  const listEl = document.getElementById('detail-component-list');
  const comps = mixtureStateRef.getComponents();
  listEl.innerHTML = '';

  // Sync visibility array with component count
  if (componentVisible.length !== comps.length) resetVisibility(comps.length);

  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const row = document.createElement('div');
    row.className = 'component-row';

    const dot = document.createElement('span');
    dot.className = 'component-dot';
    const color = componentColor(i);

    // Visual: filled = visible, hollow ring = hidden
    if (componentVisible[i]) {
      dot.style.background = color;
      dot.style.border = 'none';
    } else {
      dot.style.background = 'transparent';
      dot.style.border = `2px solid ${color}`;
    }

    // Click/double-click on dot: toggle/solo
    let dotClickTimer = null;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dotClickTimer) {
        // Double-click
        clearTimeout(dotClickTimer);
        dotClickTimer = null;
        if (soloIndex === i) {
          soloIndex = -1;
          componentVisible.fill(true);
        } else {
          soloIndex = i;
          componentVisible.fill(false);
          componentVisible[i] = true;
        }
        renderComponentList();
        renderLossChart(true);
        renderSimplexChart();
      } else {
        dotClickTimer = setTimeout(() => {
          dotClickTimer = null;
          componentVisible[i] = !componentVisible[i];
          if (soloIndex >= 0) soloIndex = -1;
          renderComponentList();
          renderLossChart(true);
          renderSimplexChart();
        }, 250);
      }
    });

    const coords = document.createElement('span');
    coords.className = 'component-coords';
    coords.textContent = `(${c.x.toFixed(3)}, ${c.a.toFixed(3)})`;

    const weightCell = document.createElement('span');
    weightCell.className = 'component-weight param-cell';
    weightCell.dataset.min = '0.01';
    weightCell.dataset.max = '0.99';
    weightCell.dataset.step = '0.01';
    weightCell.dataset.value = c.weight.toFixed(2);
    weightCell.innerHTML = `<span class="param-label">\u03C0</span><span class="param-value">${c.weight.toFixed(2)}</span>`;

    const remove = document.createElement('button');
    remove.className = 'component-remove';
    remove.textContent = '\u00d7';
    remove.addEventListener('click', () => {
      mixtureStateRef.removeComponent(i);
      componentVisible.splice(i, 1);
      if (soloIndex === i) soloIndex = -1;
      else if (soloIndex > i) soloIndex--;
      const remaining = mixtureStateRef.getComponents();
      if (remaining.length < 2) {
        // Fall back to single-point or close
        if (remaining.length === 1) {
          showPanel(processName, remaining[0].x, remaining[0].a, _onClose);
        } else {
          hidePanel();
          if (_onClose) _onClose();
        }
        return;
      }
      renderComponentList();
      recomputeAndRender();
    });

    row.appendChild(dot);
    row.appendChild(coords);
    row.appendChild(weightCell);
    row.appendChild(remove);
    listEl.appendChild(row);

    // Wire weight scrubbing
    initParamCell(weightCell, (v) => {
      mixtureStateRef.updateWeight(i, v);
      renderComponentList();
      recomputeAndRender();
    });
  }
}

export function hidePanel() {
  if (!isOpen && !isMinimized) return;
  panelEl.classList.remove('open', 'minimized');
  document.getElementById('canvas-container').classList.remove('panel-open');
  document.getElementById('detail-tab').classList.remove('visible');
  isOpen = false;
  isMinimized = false;
  currentPoint = null;
  currentData = null;
  mixtureMode = false;
  mixtureData = null;
  mixtureStateRef = null;
  inspectMode = false;
  inspectPoint = null;
  inspectData = null;
  document.getElementById('detail-back-mix').style.display = 'none';
}

function minimizePanel() {
  if (!isOpen || isMinimized) return;
  panelEl.classList.remove('open');
  panelEl.classList.add('minimized');
  document.getElementById('canvas-container').classList.remove('panel-open');
  document.getElementById('detail-tab').classList.add('visible');
  isOpen = false;
  isMinimized = true;
}

function restorePanel() {
  if (!isMinimized) return;
  panelEl.classList.remove('minimized');
  panelEl.classList.add('open');
  document.getElementById('canvas-container').classList.add('panel-open');
  document.getElementById('detail-tab').classList.remove('visible');
  isOpen = true;
  isMinimized = false;
}

export function isPanelOpen() {
  return isOpen || isMinimized;
}

function recomputeAndRender() {
  // Inspect mode: recompute single-point data without touching mixture state
  if (inspectMode && inspectPoint && processName) {
    const process = getProcess(processName);
    inspectData = computeDetailData(
      process, inspectPoint.x, inspectPoint.a,
      panelParams.contextLength, panelParams.batchSize, panelParams.seed,
    );
    inspectData.hMu = estimateEntropyRate(process, inspectPoint.x, inspectPoint.a);
    currentData = inspectData;
    const holdMixtureMode = mixtureMode;
    mixtureMode = false;
    renderLossChart();
    renderSimplexChart();
    mixtureMode = holdMixtureMode;
    return;
  }

  if (mixtureMode && mixtureStateRef) {
    const comps = mixtureStateRef.getComponents();
    if (comps.length < 2) return;
    mixtureData = computeMixtureData(
      processName, comps,
      panelParams.contextLength, panelParams.batchSize, panelParams.seed,
    );
    // Also set currentData to the mixture-averaged data for chart functions
    currentData = {
      avgLosses: mixtureData.mixtureAvgLosses,
      stdLosses: mixtureData.mixtureStdLosses,
      optimalLosses: mixtureData.mixtureOptimalLosses,
      stdOptimalLosses: mixtureData.mixtureStdOptimal,
      entropyRate: mixtureData.compositeEntropyRate,
      hMu: mixtureData.compositeHMu,
      randomGuessing: mixtureData.randomGuessing,
      beliefs: mixtureData.perComponent[0].beliefs, // placeholder for simplex
    };
    renderLossChart();
    renderSimplexChart();
  } else if (currentPoint && processName) {
    const process = getProcess(processName);
    mixtureData = null;
    currentData = computeDetailData(
      process,
      currentPoint.x,
      currentPoint.a,
      panelParams.contextLength,
      panelParams.batchSize,
      panelParams.seed,
    );
    currentData.hMu = estimateEntropyRate(process, currentPoint.x, currentPoint.a);
    renderLossChart();
    renderSimplexChart();
  }
}

// --- Loss Chart (Canvas 2D) ---

function computeTargetYRange() {
  const { avgLosses, stdLosses, optimalLosses, stdOptimalLosses, hMu, entropyRate, randomGuessing } = currentData;
  const ctxLen = avgLosses.length;
  let yMin, yMax;

  if (normY) {
    let bottom;
    if (mixtureMode && viewMode === 'per' && mixtureData) {
      // Use lowest ĥ_μ from visible components
      bottom = Infinity;
      for (let j = 0; j < mixtureData.perComponent.length; j++) {
        if (!componentVisible[j]) continue;
        const pc = mixtureData.perComponent[j];
        const h = pc.hMu != null ? pc.hMu : pc.entropyRate;
        if (h < bottom) bottom = h;
      }
      if (!isFinite(bottom)) bottom = hMu || entropyRate;
    } else {
      bottom = hMu || entropyRate;
    }
    const optimalPos = 0.15, randomPos = 0.85;
    const visualRange = randomPos - optimalPos;
    const dataRange = randomGuessing - bottom;
    const yRange = dataRange / visualRange;
    yMin = bottom - optimalPos * yRange;
    yMax = yMin + yRange;
  } else {
    yMin = 0;
    yMax = 0;

    // Skip mixture-averaged data when in Per mode (only show per-component)
    const skipMixture = mixtureMode && viewMode === 'per';

    if (chartToggles.logV) yMax = Math.max(yMax, randomGuessing);
    if (!skipMixture && chartToggles.entropyRate) yMax = Math.max(yMax, entropyRate);
    if (!skipMixture && chartToggles.hMu && hMu != null) yMax = Math.max(yMax, hMu);

    if (!skipMixture && (chartToggles.loss || (chartToggles.sigma && chartToggles.loss))) {
      for (let i = 0; i < ctxLen; i++) {
        if (chartToggles.sigma && stdLosses) {
          yMax = Math.max(yMax, avgLosses[i] + stdLosses[i]);
        } else {
          yMax = Math.max(yMax, avgLosses[i]);
        }
      }
    }

    if (!skipMixture && chartToggles.optimalLoss && optimalLosses) {
      for (let i = 0; i < ctxLen; i++) {
        if (chartToggles.sigma && stdOptimalLosses) {
          yMax = Math.max(yMax, optimalLosses[i] + stdOptimalLosses[i]);
        } else {
          yMax = Math.max(yMax, optimalLosses[i]);
        }
      }
    }

    if (!skipMixture && chartToggles.lbar) {
      let avg = 0;
      for (let i = 0; i < ctxLen; i++) avg += avgLosses[i];
      yMax = Math.max(yMax, avg / ctxLen);
    }

    if (!skipMixture && chartToggles.lbarStar && optimalLosses) {
      let avg = 0;
      for (let i = 0; i < ctxLen; i++) avg += optimalLosses[i];
      yMax = Math.max(yMax, avg / ctxLen);
    }

    // In Per mode, also consider per-component data
    if (mixtureMode && mixtureData && viewMode === 'per') {
      for (let j = 0; j < mixtureData.perComponent.length; j++) {
        if (!componentVisible[j]) continue;
        const pc = mixtureData.perComponent[j];
        if (chartToggles.optimalLoss && pc.optimalLosses) {
          for (let i = 0; i < ctxLen; i++) yMax = Math.max(yMax, pc.optimalLosses[i]);
        }
        if (chartToggles.loss) {
          for (let i = 0; i < ctxLen; i++) yMax = Math.max(yMax, pc.avgLosses[i]);
        }
        if (chartToggles.hMu && pc.hMu != null) yMax = Math.max(yMax, pc.hMu);
      }
    }

    if (yMax <= 0) yMax = randomGuessing;
    yMax *= 1.05;
  }

  return { yMin, yMax };
}

function renderLossChart(animate = false) {
  if (!currentData) return;
  const target = computeTargetYRange();

  if (animate && Math.abs(target.yMin - animYMin) + Math.abs(target.yMax - animYMax) > 1e-6) {
    animFromYMin = animYMin;
    animFromYMax = animYMax;
    animStartTime = performance.now();
    if (animFrameId) cancelAnimationFrame(animFrameId);

    function step() {
      const elapsed = performance.now() - animStartTime;
      const t = Math.min(1, elapsed / ANIM_DURATION);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      animYMin = animFromYMin + (target.yMin - animFromYMin) * ease;
      animYMax = animFromYMax + (target.yMax - animFromYMax) * ease;
      drawLossChart(animYMin, animYMax);
      if (t < 1) {
        animFrameId = requestAnimationFrame(step);
      } else {
        animFrameId = null;
      }
    }
    step();
  } else {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    animYMin = target.yMin;
    animYMax = target.yMax;
    drawLossChart(animYMin, animYMax);
  }
}

function drawLossChart(yMin, yMax) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = lossCanvas.parentElement.clientWidth - 24;
  const cssH = LOSS_CANVAS_HEIGHT;
  lossCanvas.width = cssW * dpr;
  lossCanvas.height = cssH * dpr;
  lossCanvas.style.width = cssW + 'px';
  lossCanvas.style.height = cssH + 'px';
  const ctx = lossCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const { avgLosses, stdLosses, optimalLosses, stdOptimalLosses, hMu, entropyRate, randomGuessing } = currentData;
  const ctxLen = avgLosses.length;

  const margin = { top: 12, right: 44, bottom: 28, left: 42 };
  const plotW = cssW - margin.left - margin.right;
  const plotH = cssH - margin.top - margin.bottom;

  const textMuted = getCSSVar('--text-muted');
  const accent = getCSSVar('--accent');
  const border = getCSSVar('--border');
  const text = getCSSVar('--text');

  ctx.clearRect(0, 0, cssW, cssH);

  function xPx(t) { return margin.left + (t / (ctxLen - 1)) * plotW; }
  function yPx(v) { return margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH; }

  // Grid lines and Y-axis ticks
  ctx.font = getFont(10);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const nTicks = 5;
  for (let i = 0; i <= nTicks; i++) {
    const yVal = yMin + (i / nTicks) * (yMax - yMin);
    const py = yPx(yVal);
    ctx.strokeStyle = border;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(margin.left, py);
    ctx.lineTo(margin.left + plotW, py);
    ctx.stroke();
    ctx.fillStyle = textMuted;
    ctx.fillText(yVal.toFixed(2), margin.left - 4, py);
  }

  // Axes
  ctx.strokeStyle = textMuted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // X-axis label
  ctx.fillStyle = textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('t', margin.left + plotW / 2, margin.top + plotH + 14);

  // Dashed line: random guessing = log(V)
  if (chartToggles.logV) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const rgY = yPx(randomGuessing);
    ctx.moveTo(margin.left, rgY);
    ctx.lineTo(margin.left + plotW, rgY);
    ctx.stroke();
    ctx.fillStyle = textMuted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('log V', margin.left + plotW + 3, rgY);
    ctx.setLineDash([]);
  }

  // Skip mixture-averaged curves when in Per mode
  const skipMixtureCurves = mixtureMode && viewMode === 'per';

  // Dashed line: emission entropy H(O|S) (lower bound on entropy rate)
  if (chartToggles.entropyRate && !skipMixtureCurves) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const erY = yPx(entropyRate);
    ctx.moveTo(margin.left, erY);
    ctx.lineTo(margin.left + plotW, erY);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('H(O|S)', margin.left + plotW + 3, erY);
    ctx.setLineDash([]);
  }

  // Dashed line: asymptotic entropy rate estimate ĥ_μ
  if (chartToggles.hMu && hMu != null && !skipMixtureCurves) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const hmY = yPx(hMu);
    ctx.moveTo(margin.left, hmY);
    ctx.lineTo(margin.left + plotW, hmY);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('\u0125\u03BC', margin.left + plotW + 3, hmY);
    ctx.setLineDash([]);
  }

  // Shaded ±σ band around L(t)
  if (chartToggles.sigma && chartToggles.loss && stdLosses && !skipMixtureCurves) {
    ctx.fillStyle = text + '1a';
    ctx.beginPath();
    ctx.moveTo(xPx(0), yPx(Math.min(yMax, avgLosses[0] + stdLosses[0])));
    for (let t = 1; t < ctxLen; t++) {
      ctx.lineTo(xPx(t), yPx(Math.min(yMax, avgLosses[t] + stdLosses[t])));
    }
    for (let t = ctxLen - 1; t >= 0; t--) {
      ctx.lineTo(xPx(t), yPx(Math.max(yMin, avgLosses[t] - stdLosses[t])));
    }
    ctx.closePath();
    ctx.fill();
  }

  // Shaded ±σ band around L*(t)
  if (chartToggles.sigma && chartToggles.optimalLoss && stdOptimalLosses && !skipMixtureCurves) {
    ctx.fillStyle = accent + '26';
    ctx.beginPath();
    ctx.moveTo(xPx(0), yPx(Math.min(yMax, optimalLosses[0] + stdOptimalLosses[0])));
    for (let t = 1; t < ctxLen; t++) {
      ctx.lineTo(xPx(t), yPx(Math.min(yMax, optimalLosses[t] + stdOptimalLosses[t])));
    }
    for (let t = ctxLen - 1; t >= 0; t--) {
      ctx.lineTo(xPx(t), yPx(Math.max(yMin, optimalLosses[t] - stdOptimalLosses[t])));
    }
    ctx.closePath();
    ctx.fill();
  }

  // Dashed line: context-averaged loss (L̄)
  if (chartToggles.lbar && !skipMixtureCurves) {
    let avgOverCtx = 0;
    for (let t = 0; t < ctxLen; t++) avgOverCtx += avgLosses[t];
    avgOverCtx /= ctxLen;
    const avgY = yPx(avgOverCtx);
    if (avgOverCtx >= yMin && avgOverCtx <= yMax) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = text;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, avgY);
      ctx.lineTo(margin.left + plotW, avgY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('L\u0304', margin.left + plotW + 3, avgY);
    }
  }

  // Dashed line: context-averaged optimal loss (L̄*)
  if (chartToggles.lbarStar && optimalLosses && !skipMixtureCurves) {
    let avgOptimal = 0;
    for (let t = 0; t < ctxLen; t++) avgOptimal += optimalLosses[t];
    avgOptimal /= ctxLen;
    const avgY = yPx(avgOptimal);
    if (avgOptimal >= yMin && avgOptimal <= yMax) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, avgY);
      ctx.lineTo(margin.left + plotW, avgY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('L\u0304*', margin.left + plotW + 3, avgY);
    }
  }

  // Solid line: per-position optimal loss L*(t) (Rao-Blackwellized)
  if (chartToggles.optimalLoss && optimalLosses && !skipMixtureCurves) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xPx(0), yPx(optimalLosses[0]));
    for (let t = 1; t < ctxLen; t++) {
      ctx.lineTo(xPx(t), yPx(optimalLosses[t]));
    }
    ctx.stroke();
  }

  // Solid line: realized per-position loss L(t)
  if (chartToggles.loss && !skipMixtureCurves) {
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xPx(0), yPx(avgLosses[0]));
    for (let t = 1; t < ctxLen; t++) {
      ctx.lineTo(xPx(t), yPx(avgLosses[t]));
    }
    ctx.stroke();
  }

  // Per-component overlay (mixture Per mode)
  if (mixtureMode && mixtureData && viewMode === 'per') {
    const comps = mixtureStateRef.getComponents();
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      const pc = mixtureData.perComponent[i];
      const color = componentColor(i);
      const alpha = Math.max(0.3, comps[i].weight);

      // Per-component L*(t)
      if (chartToggles.optimalLoss && pc.optimalLosses) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xPx(0), yPx(pc.optimalLosses[0]));
        for (let t = 1; t < ctxLen; t++) {
          ctx.lineTo(xPx(t), yPx(pc.optimalLosses[t]));
        }
        ctx.stroke();
      }

      // Per-component L(t)
      if (chartToggles.loss) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(xPx(0), yPx(pc.avgLosses[0]));
        for (let t = 1; t < ctxLen; t++) {
          ctx.lineTo(xPx(t), yPx(pc.avgLosses[t]));
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Per-component ĥ_μ
      if (chartToggles.hMu && pc.hMu != null) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const hmY = yPx(pc.hMu);
        ctx.moveTo(margin.left, hmY);
        ctx.lineTo(margin.left + plotW, hmY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;
    }
  }
}

// --- Belief Simplex (Canvas 2D) ---

function renderSimplexChart() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = simplexCanvas.parentElement.clientWidth - 24;
  const cssH = SIMPLEX_CANVAS_HEIGHT;
  simplexCanvas.width = cssW * dpr;
  simplexCanvas.height = cssH * dpr;
  simplexCanvas.style.width = cssW + 'px';
  simplexCanvas.style.height = cssH + 'px';
  const ctx = simplexCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const textMuted = getCSSVar('--text-muted');
  const accent = getCSSVar('--accent');
  const border = getCSSVar('--border');

  ctx.clearRect(0, 0, cssW, cssH);

  // Equilateral triangle geometry
  const pad = 24;
  const triSide = Math.min(cssW - pad * 2, (cssH - pad * 2) / (Math.sqrt(3) / 2));
  const cx = cssW / 2;
  const triH = triSide * Math.sqrt(3) / 2;
  const cy = pad + triH / 2;

  // Vertices: v0=top (s0), v1=bottom-left (s1), v2=bottom-right (s2)
  const v0 = { x: cx, y: cy - triH / 2 };
  const v1 = { x: cx - triSide / 2, y: cy + triH / 2 };
  const v2 = { x: cx + triSide / 2, y: cy + triH / 2 };

  // Draw triangle outline
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(v0.x, v0.y);
  ctx.lineTo(v1.x, v1.y);
  ctx.lineTo(v2.x, v2.y);
  ctx.closePath();
  ctx.stroke();

  // Vertex labels
  ctx.font = getFont(10);
  ctx.fillStyle = textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('s\u2080', v0.x, v0.y - 4);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'right';
  ctx.fillText('s\u2081', v1.x - 4, v1.y + 2);
  ctx.textAlign = 'left';
  ctx.fillText('s\u2082', v2.x + 4, v2.y + 2);

  function baryToPixel(p0, p1, p2) {
    return {
      x: p0 * v0.x + p1 * v1.x + p2 * v2.x,
      y: p0 * v0.y + p1 * v1.y + p2 * v2.y,
    };
  }

  const S = 3;
  const ctxLen = panelParams.contextLength;

  if (mixtureMode && mixtureData) {
    // Per-component belief trajectories in component colors
    const comps = mixtureStateRef.getComponents();
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      const pc = mixtureData.perComponent[i];
      ctx.fillStyle = componentColor(i);
      ctx.globalAlpha = Math.max(0.3, comps[i].weight);
      for (let b = 0; b < pc.beliefs.length; b++) {
        const traj = pc.beliefs[b];
        for (let t = 0; t < ctxLen; t++) {
          const pt = baryToPixel(traj[t * S], traj[t * S + 1], traj[t * S + 2]);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  } else {
    const { beliefs } = currentData;
    ctx.fillStyle = accent;
    for (let b = 0; b < beliefs.length; b++) {
      const traj = beliefs[b];
      for (let t = 0; t < ctxLen; t++) {
        const pt = baryToPixel(traj[t * S], traj[t * S + 1], traj[t * S + 2]);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
