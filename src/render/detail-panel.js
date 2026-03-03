// Detail panel: shows per-position loss curve and belief simplex trajectory
// for a single (x, α) parameterization.

import { computeDetailData, estimateEntropyRate } from '../compute/detail-compute.js';
import { getProcess } from '../processes/registry.js';
import { initParamCell } from '../ui/controls.js';

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
  sigma: false, lbar: false, entropyRate: false, logV: true,
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
      <span class="detail-coords">
        <span class="info-label">x</span> <span class="info-value" id="detail-x">&mdash;</span>
        <span class="info-label">&alpha;</span> <span class="info-value" id="detail-a">&mdash;</span>
      </span>
      <span class="detail-header-btns">
        <button class="text-toggle" id="detail-minimize">&minus;</button>
        <button class="text-toggle" id="detail-close">&times;</button>
      </span>
    </div>
    <div class="detail-section">
      <div class="detail-section-label">
        Myopic Loss Convergence
        <span class="detail-chart-controls">
          <div class="chart-lines-dropdown" id="chart-lines-dropdown">
            <button class="text-toggle" id="chart-lines-trigger">Lines &#9662;</button>
            <div class="chart-lines-menu" id="chart-lines-menu">
              <div class="chart-lines-item" data-key="loss"><span class="chart-lines-check"></span> L(t)</div>
              <div class="chart-lines-item" data-key="optimalLoss"><span class="chart-lines-check">&#10003;</span> L*(t)</div>
              <div class="chart-lines-item" data-key="hMu"><span class="chart-lines-check">&#10003;</span> &#x0125;<sub>&mu;</sub></div>
              <div class="chart-lines-item" data-key="sigma"><span class="chart-lines-check"></span> &plusmn;&sigma;</div>
              <div class="chart-lines-item" data-key="lbar"><span class="chart-lines-check"></span> L&#772;</div>
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

export function hidePanel() {
  if (!isOpen && !isMinimized) return;
  panelEl.classList.remove('open', 'minimized');
  document.getElementById('canvas-container').classList.remove('panel-open');
  document.getElementById('detail-tab').classList.remove('visible');
  isOpen = false;
  isMinimized = false;
  currentPoint = null;
  currentData = null;
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
  if (!currentPoint || !processName) return;
  const process = getProcess(processName);
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

// --- Loss Chart (Canvas 2D) ---

function computeTargetYRange() {
  const { avgLosses, stdLosses, optimalLosses, stdOptimalLosses, hMu, entropyRate, randomGuessing } = currentData;
  const ctxLen = avgLosses.length;
  let yMin, yMax;

  if (normY) {
    const bottom = hMu || entropyRate;
    const optimalPos = 0.15, randomPos = 0.85;
    const visualRange = randomPos - optimalPos;
    const dataRange = randomGuessing - bottom;
    const yRange = dataRange / visualRange;
    yMin = bottom - optimalPos * yRange;
    yMax = yMin + yRange;
  } else {
    yMin = 0;
    yMax = 0;

    if (chartToggles.logV) yMax = Math.max(yMax, randomGuessing);
    if (chartToggles.entropyRate) yMax = Math.max(yMax, entropyRate);
    if (chartToggles.hMu && hMu != null) yMax = Math.max(yMax, hMu);

    if (chartToggles.loss || (chartToggles.sigma && chartToggles.loss)) {
      for (let i = 0; i < ctxLen; i++) {
        if (chartToggles.sigma && stdLosses) {
          yMax = Math.max(yMax, avgLosses[i] + stdLosses[i]);
        } else {
          yMax = Math.max(yMax, avgLosses[i]);
        }
      }
    }

    if (chartToggles.optimalLoss && optimalLosses) {
      for (let i = 0; i < ctxLen; i++) {
        if (chartToggles.sigma && stdOptimalLosses) {
          yMax = Math.max(yMax, optimalLosses[i] + stdOptimalLosses[i]);
        } else {
          yMax = Math.max(yMax, optimalLosses[i]);
        }
      }
    }

    if (chartToggles.lbar) {
      let avg = 0;
      for (let i = 0; i < ctxLen; i++) avg += avgLosses[i];
      yMax = Math.max(yMax, avg / ctxLen);
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

  // Dashed line: emission entropy H(O|S) (lower bound on entropy rate)
  if (chartToggles.entropyRate) {
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
  if (chartToggles.hMu && hMu != null) {
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
  if (chartToggles.sigma && chartToggles.loss && stdLosses) {
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
  if (chartToggles.sigma && chartToggles.optimalLoss && stdOptimalLosses) {
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
  if (chartToggles.lbar) {
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

  // Solid line: per-position optimal loss L*(t) (Rao-Blackwellized)
  if (chartToggles.optimalLoss && optimalLosses) {
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
  if (chartToggles.loss) {
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xPx(0), yPx(avgLosses[0]));
    for (let t = 1; t < ctxLen; t++) {
      ctx.lineTo(xPx(t), yPx(avgLosses[t]));
    }
    ctx.stroke();
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

  const { beliefs } = currentData;
  const S = 3;
  const ctxLen = panelParams.contextLength;

  // All belief points from all sequences
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
