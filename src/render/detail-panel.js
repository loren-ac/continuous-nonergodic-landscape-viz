// Detail panel: tabbed architecture with explore (single-point) and
// compound (mixture) tabs for loss curve and belief simplex visualization.

import { computeDetailData, estimateEntropyRate } from '../compute/detail-compute.js';
import { computeMixtureData } from '../compute/mixture-compute.js';
import { getProcess } from '../processes/registry.js';
import { initParamCell } from '../ui/controls.js';
import { componentColor } from './component-colors.js';
import * as tabState from '../state/tab-state.js';

const LOSS_CANVAS_HEIGHT = 180;
const SIMPLEX_CANVAS_HEIGHT = 200;

let panelEl = null;
let lossCanvas = null;
let lossCtx = null;

let geometryToggles = { belief: true, obs: false, logObs: false };
let exportMode = 'nonergodic'; // 'nonergodic' | 'sweep'
let logObsAngle = 0;
let logObsDragState = null;

// Render-time state (loaded from active tab by loadActiveTab)
let currentData = null;
let mixtureMode = false;
let mixtureData = null;
let viewMode = 'mix';
let componentVisible = [];
let soloIndex = -1;
let activeComponents = [];  // components array for drawing functions

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
      <div class="tab-bar" id="tab-bar"></div>
      <span class="detail-header-btns">
        <button class="text-toggle" id="detail-minimize">&minus;</button>
        <button class="text-toggle" id="detail-close">&times;</button>
      </span>
    </div>
    <div class="detail-coords-bar" id="detail-coords-bar" style="display:none;">
      <span class="info-label">x</span> <span class="info-value" id="detail-x">&mdash;</span>
      <span class="info-label">&alpha;</span> <span class="info-value" id="detail-a">&mdash;</span>
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
    <div class="detail-section" id="geometry-section">
      <div class="detail-section-label">
        Geometry
        <span class="detail-chart-controls" id="geometry-toggles">
          <button class="seg-btn active" data-geo="belief">Belief</button>
          <button class="seg-btn" data-geo="obs">Obs</button>
          <button class="seg-btn" data-geo="logObs">Log</button>
        </span>
      </div>
      <div class="geometry-container" id="geometry-container"></div>
    </div>
    <div class="detail-section" id="export-section">
      <div class="detail-section-label">
        Export
        <span class="detail-chart-controls" id="export-mode-toggle" style="display:none;">
          <button class="seg-btn active" data-export="nonergodic">Nonergodic</button>
          <button class="seg-btn" data-export="sweep">Sweep</button>
        </span>
      </div>
      <div class="export-code-wrap">
        <pre class="export-code" id="export-code"></pre>
        <button class="export-copy-btn" id="export-copy" title="Copy to clipboard">&#x2398;</button>
      </div>
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

  // Minimize restore tab (separate body-level element)
  const tabEl = document.createElement('div');
  tabEl.id = 'detail-tab';
  tabEl.className = 'detail-tab';
  tabEl.innerHTML = '&#9654;';
  document.body.appendChild(tabEl);

  lossCanvas = document.getElementById('detail-loss-canvas');
  lossCtx = lossCanvas.getContext('2d');
  rebuildGeometryCanvases();

  // Panel-level close: close all tabs
  document.getElementById('detail-close').addEventListener('click', () => {
    const tabs = tabState.getTabs();
    for (const t of tabs) tabState.closeTab(t.id);
    hidePanel();
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

  // Norm button
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
    const newMode = btn.dataset.view;
    const activeId = tabState.getActiveTabId();
    if (activeId != null) {
      tabState.setViewMode(activeId, newMode);
    }
    viewMode = newMode;
    viewToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewMode));
    renderLossChart(true);
    renderAllGeometry();
  });

  // Geometry toggles (multi-select)
  const geoToggles = document.getElementById('geometry-toggles');
  geoToggles.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn[data-geo]');
    if (!btn) return;
    const key = btn.dataset.geo;
    geometryToggles[key] = !geometryToggles[key];
    // Ensure at least one is active
    if (!geometryToggles.belief && !geometryToggles.obs && !geometryToggles.logObs) {
      geometryToggles[key] = true;
    }
    btn.classList.toggle('active', geometryToggles[key]);
    rebuildGeometryCanvases();
    renderAllGeometry();
  });

  // Export mode toggle (Nonergodic / Sweep)
  const exportToggle = document.getElementById('export-mode-toggle');
  exportToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn[data-export]');
    if (!btn) return;
    exportMode = btn.dataset.export;
    exportToggle.querySelectorAll('.seg-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.export === exportMode)
    );
    updateExport();
  });

  // Export copy button
  document.getElementById('export-copy').addEventListener('click', () => {
    const code = document.getElementById('export-code').textContent;
    navigator.clipboard.writeText(code);
    const btn = document.getElementById('export-copy');
    btn.textContent = '\u2713';
    setTimeout(() => { btn.textContent = '\u2398'; }, 1200);
  });

  // Param cells — wire through tabState
  initParamCell(document.getElementById('detail-ctx'), (v) => {
    tabState.setPanelParam('contextLength', Math.round(v));
  });
  initParamCell(document.getElementById('detail-batch'), (v) => {
    tabState.setPanelParam('batchSize', Math.round(v));
  });
  initParamCell(document.getElementById('detail-seed'), (v) => {
    tabState.setPanelParam('seed', Math.round(v));
  });

  // Listen for tab state changes
  tabState.onChange(({ reason }) => {
    if (reason === 'tab-switch' || reason === 'tab-created' || reason === 'tab-closed') {
      loadActiveTab();
    } else if (reason === 'data-change') {
      const tab = tabState.getActiveTab();
      if (tab?.type === 'compound') {
        activeComponents = tab.components;
        componentVisible = [...tab.componentVisible];
        soloIndex = tab.soloIndex;
        renderComponentList(tab);
      }
      recomputeActiveTab();
      renderTabBar();
      updateExport();
    } else if (reason === 'param-change') {
      recomputeActiveTab();
    } else if (reason === 'visibility-change') {
      const tab = tabState.getActiveTab();
      if (tab && tab.type === 'compound') {
        viewMode = tab.viewMode;
        componentVisible = [...tab.componentVisible];
        soloIndex = tab.soloIndex;
        const viewToggleEl = document.getElementById('detail-view-toggle');
        viewToggleEl.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.view === viewMode));
        renderComponentList(tab);
      }
      renderLossChart(true);
      renderAllGeometry();
    }
  });
}

// --- Tab Bar ---

function renderTabBar() {
  const bar = document.getElementById('tab-bar');
  const tabs = tabState.getTabs();
  const activeId = tabState.getActiveTabId();
  bar.innerHTML = '';

  for (const tab of tabs) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === activeId ? ' active' : '');
    el.dataset.tabId = tab.id;

    const label = document.createElement('span');
    label.className = 'tab-label';
    if (tab.type === 'explore') {
      label.textContent = `${tab.point.x.toFixed(2)}, ${tab.point.a.toFixed(2)}`;
    } else {
      label.textContent = `Mix (${tab.components.length})`;
    }

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.innerHTML = '&times;';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      tabState.closeTab(tab.id);
    });

    el.addEventListener('click', () => {
      tabState.activateTab(tab.id);
    });

    el.appendChild(label);
    el.appendChild(close);
    bar.appendChild(el);
  }
}

// --- Load Active Tab ---

function loadActiveTab() {
  const tab = tabState.getActiveTab();

  if (!tab) {
    hidePanel();
    return;
  }

  if (tab.type === 'explore') {
    mixtureMode = false;
    mixtureData = null;
    viewMode = 'mix';
    componentVisible = [];
    soloIndex = -1;
    activeComponents = [];

    document.getElementById('detail-coords-bar').style.display = '';
    document.getElementById('detail-x').textContent = tab.point.x.toFixed(4);
    document.getElementById('detail-a').textContent = tab.point.a.toFixed(4);
    document.getElementById('detail-component-list').style.display = 'none';
    document.getElementById('detail-view-toggle').style.display = 'none';
    document.getElementById('export-mode-toggle').style.display = 'none';

    const cached = tabState.getCachedData(tab.id);
    if (cached) {
      currentData = cached;
      renderTabBar();
      renderLossChart(true);
      renderAllGeometry();
    } else {
      renderTabBar();
      recomputeActiveTab();
    }

  } else if (tab.type === 'compound') {
    mixtureMode = true;
    viewMode = tab.viewMode;
    componentVisible = [...tab.componentVisible];
    soloIndex = tab.soloIndex;
    activeComponents = tab.components;

    document.getElementById('detail-coords-bar').style.display = 'none';
    document.getElementById('detail-component-list').style.display = '';
    document.getElementById('detail-view-toggle').style.display = '';
    document.getElementById('export-mode-toggle').style.display = '';

    const viewToggleEl = document.getElementById('detail-view-toggle');
    viewToggleEl.querySelectorAll('.seg-btn').forEach(
      b => b.classList.toggle('active', b.dataset.view === viewMode)
    );

    renderComponentList(tab);

    const cached = tabState.getCachedData(tab.id);
    if (cached) {
      mixtureData = cached.mixtureData;
      currentData = cached.currentData;
      renderTabBar();
      renderLossChart(true);
      renderAllGeometry();
    } else {
      renderTabBar();
      recomputeActiveTab();
    }
  }

  updateExport();
  ensurePanelOpen();
}

function ensurePanelOpen() {
  if (isMinimized) {
    restorePanel();
  } else if (!isOpen) {
    panelEl.classList.add('open');
    document.getElementById('canvas-container').classList.add('panel-open');
    isOpen = true;
  }
}

// --- Export YAML ---

function updateExport() {
  const tab = tabState.getActiveTab();
  const codeEl = document.getElementById('export-code');
  if (!tab) { codeEl.textContent = ''; return; }

  const pName = tabState.getProcessName();
  const process = getProcess(pName);
  const paramNames = process.params.map(p => p.name);

  if (tab.type === 'explore') {
    codeEl.textContent = generateErgodicYaml(pName, paramNames, tab.point);
  } else if (tab.type === 'compound') {
    if (exportMode === 'nonergodic') {
      codeEl.textContent = generateNonergodicYaml(pName, paramNames, tab.components);
    } else {
      codeEl.textContent = generateSweepYaml(pName, paramNames, tab.components);
    }
  }
}

function generateErgodicYaml(processName, paramNames, point) {
  const vals = [point.x, point.a];
  const paramsBlock = paramNames.map((n, i) =>
    `    ${n}: ${vals[i]}`
  ).join('\n');
  return `name: ${processName}
instance:
  _target_: simplexity.generative_processes.builder.build_hidden_markov_model
  process_name: ${processName}
  process_params:
${paramsBlock}
  device: \${device}

base_vocab_size: ???
bos_token: ???
eos_token: null
vocab_size: ???`;
}

function generateNonergodicYaml(processName, paramNames, components) {
  const comps = components.map(c => {
    const vals = [c.x, c.a];
    const paramsBlock = paramNames.map((n, i) =>
      `        ${n}: ${vals[i]}`
    ).join('\n');
    return `    - component_type: hmm
      process_name: ${processName}
      process_params:
${paramsBlock}`;
  }).join('\n');

  const weights = components.map(c => +c.weight.toFixed(4));
  return `instance:
  _target_: simplexity.generative_processes.builder.build_nonergodic_process_from_spec
  components:
${comps}
  component_weights: [${weights.join(', ')}]
  vocab_maps: null`;
}

function generateSweepYaml(processName, paramNames, components) {
  const first = components[0];
  const firstVals = [first.x, first.a];
  const baseParams = paramNames.map((n, i) =>
    `    ${n}: ${firstVals[i]}`
  ).join('\n');

  const base = `name: ${processName}
instance:
  _target_: simplexity.generative_processes.builder.build_hidden_markov_model
  process_name: ${processName}
  process_params:
${baseParams}
  device: \${device}

base_vocab_size: ???
bos_token: ???
eos_token: null
vocab_size: ???`;

  const sweepLines = paramNames.map((n, pi) => {
    const vals = components.map(c => pi === 0 ? c.x : c.a);
    const items = vals.map(v => `  - ${v}`).join('\n');
    return `generative_process.instance.process_params.${n}:\n${items}`;
  }).join('\n');

  return `# --- generative_process config (e.g. configs/generative_process/${processName}.yaml) ---
${base}

# --- sweep config (e.g. sweeps/process_params.yaml) ---
# simplexity-multirun run.py -c config --sweep-file sweeps/process_params.yaml
${sweepLines}`;
}

// --- Recompute ---

function recomputeActiveTab() {
  const tab = tabState.getActiveTab();
  if (!tab) return;
  const pName = tabState.getProcessName();
  if (!pName) return;
  const params = tabState.getPanelParams();

  if (tab.type === 'explore') {
    const process = getProcess(pName);
    currentData = computeDetailData(
      process, tab.point.x, tab.point.a,
      params.contextLength, params.batchSize, params.seed,
    );
    currentData.hMu = estimateEntropyRate(process, tab.point.x, tab.point.a);
    mixtureData = null;
    tabState.setCachedData(tab.id, currentData);

  } else if (tab.type === 'compound') {
    activeComponents = tab.components;
    if (tab.components.length >= 2) {
      mixtureData = computeMixtureData(
        pName, tab.components,
        params.contextLength, params.batchSize, params.seed,
      );
      currentData = {
        avgLosses: mixtureData.mixtureAvgLosses,
        stdLosses: mixtureData.mixtureStdLosses,
        optimalLosses: mixtureData.mixtureOptimalLosses,
        stdOptimalLosses: mixtureData.mixtureStdOptimal,
        entropyRate: mixtureData.compositeEntropyRate,
        hMu: mixtureData.compositeHMu,
        randomGuessing: mixtureData.randomGuessing,
        beliefs: mixtureData.perComponent[0].beliefs,
      };
    } else if (tab.components.length === 1) {
      const c = tab.components[0];
      const process = getProcess(pName);
      currentData = computeDetailData(
        process, c.x, c.a,
        params.contextLength, params.batchSize, params.seed,
      );
      currentData.hMu = estimateEntropyRate(process, c.x, c.a);
      mixtureData = null;
    } else {
      return;
    }
    tabState.setCachedData(tab.id, { mixtureData, currentData });
  }

  renderLossChart(true);
  renderAllGeometry();
}

// --- Component List (compound tabs) ---

function renderComponentList(tab) {
  const listEl = document.getElementById('detail-component-list');
  const comps = tab.components;
  listEl.innerHTML = '';

  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    const row = document.createElement('div');
    row.className = 'component-row';

    const dot = document.createElement('span');
    dot.className = 'component-dot';
    const color = componentColor(i);

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
        clearTimeout(dotClickTimer);
        dotClickTimer = null;
        // Double-click: solo/unsolo
        tabState.setSoloComponent(tab.id, soloIndex === i ? -1 : i);
      } else {
        dotClickTimer = setTimeout(() => {
          dotClickTimer = null;
          // Single click: toggle visibility
          tabState.setComponentVisible(tab.id, i, !componentVisible[i]);
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
      tabState.removeComponent(tab.id, i);
    });

    row.appendChild(dot);
    row.appendChild(coords);
    row.appendChild(weightCell);
    row.appendChild(remove);
    listEl.appendChild(row);

    initParamCell(weightCell, (v) => {
      tabState.updateWeight(tab.id, i, v);
    });
  }
}

// --- Panel visibility ---

export function hidePanel() {
  if (!isOpen && !isMinimized) return;
  panelEl.classList.remove('open', 'minimized');
  document.getElementById('canvas-container').classList.remove('panel-open');
  document.getElementById('detail-tab').classList.remove('visible');
  isOpen = false;
  isMinimized = false;
  currentData = null;
  mixtureMode = false;
  mixtureData = null;
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

// --- Loss Chart (Canvas 2D) ---

function computeTargetYRange() {
  const { avgLosses, stdLosses, optimalLosses, stdOptimalLosses, hMu, entropyRate, randomGuessing } = currentData;
  const ctxLen = avgLosses.length;
  let yMin, yMax;

  if (normY) {
    let bottom;
    if (mixtureMode && viewMode === 'per' && mixtureData) {
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

  const skipMixtureCurves = mixtureMode && viewMode === 'per';

  // Dashed line: emission entropy H(O|S)
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

  // Solid line: per-position optimal loss L*(t)
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
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      const pc = mixtureData.perComponent[i];
      const color = componentColor(i);
      const alpha = Math.max(0.3, activeComponents[i] ? activeComponents[i].weight : 0.5);

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

// --- Geometry Canvases ---

function rebuildGeometryCanvases() {
  const container = document.getElementById('geometry-container');
  if (!container) return;
  container.innerHTML = '';

  // Top row: simplex canvases (belief and/or obs)
  const simplexKeys = [];
  if (geometryToggles.belief) simplexKeys.push('belief');
  if (geometryToggles.obs) simplexKeys.push('obs');

  if (simplexKeys.length > 0) {
    const row = document.createElement('div');
    row.className = 'geometry-row';
    for (const key of simplexKeys) {
      const canvas = document.createElement('canvas');
      canvas.id = `geo-canvas-${key}`;
      canvas.className = 'geometry-canvas';
      row.appendChild(canvas);
    }
    container.appendChild(row);
  }

  // Bottom row: logObs full width
  if (geometryToggles.logObs) {
    const canvas = document.createElement('canvas');
    canvas.id = 'geo-canvas-logObs';
    canvas.className = 'geometry-canvas geometry-canvas-full';
    container.appendChild(canvas);
    wireLogObsDrag(canvas);
  }
}

function renderAllGeometry() {
  if (!currentData) return;
  rebuildGeometryCanvases();

  const section = document.getElementById('geometry-section');
  if (!section) return;
  const totalW = section.clientWidth - 24;
  const simplexCount = (geometryToggles.belief ? 1 : 0) + (geometryToggles.obs ? 1 : 0);
  const simplexW = simplexCount > 1 ? Math.floor((totalW - 2) / simplexCount) : totalW;

  if (geometryToggles.belief) {
    const canvas = document.getElementById('geo-canvas-belief');
    if (canvas) renderSimplexOnCanvas(canvas, 'beliefs', ['s\u2080', 's\u2081', 's\u2082'], simplexW);
  }
  if (geometryToggles.obs) {
    const canvas = document.getElementById('geo-canvas-obs');
    if (canvas) renderSimplexOnCanvas(canvas, 'predictions', ['o\u2080', 'o\u2081', 'o\u2082'], simplexW);
  }
  if (geometryToggles.logObs) {
    const canvas = document.getElementById('geo-canvas-logObs');
    if (canvas) renderLogObs3D(canvas, totalW);
  }
}

function renderLogObs3DOnly() {
  const canvas = document.getElementById('geo-canvas-logObs');
  if (!canvas || !currentData) return;
  const section = document.getElementById('geometry-section');
  if (!section) return;
  const totalW = section.clientWidth - 24;
  renderLogObs3D(canvas, totalW);
}

function setupCanvas(canvas, cssW) {
  const cssH = SIMPLEX_CANVAS_HEIGHT;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, cssW, cssH };
}

// --- Simplex Renderer (belief or observation probability) ---

function renderSimplexOnCanvas(canvas, dataKey, labels, cssW) {
  const { ctx, cssH } = setupCanvas(canvas, cssW);
  const textMuted = getCSSVar('--text-muted');
  const accent = getCSSVar('--accent');
  const border = getCSSVar('--border');
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = 24;
  const triSide = Math.min(cssW - pad * 2, (cssH - pad * 2) / (Math.sqrt(3) / 2));
  const cx = cssW / 2;
  const triH = triSide * Math.sqrt(3) / 2;
  const cy = pad + triH / 2;

  const v0 = { x: cx, y: cy - triH / 2 };
  const v1 = { x: cx - triSide / 2, y: cy + triH / 2 };
  const v2 = { x: cx + triSide / 2, y: cy + triH / 2 };

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(v0.x, v0.y);
  ctx.lineTo(v1.x, v1.y);
  ctx.lineTo(v2.x, v2.y);
  ctx.closePath();
  ctx.stroke();

  ctx.font = getFont(10);
  ctx.fillStyle = textMuted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(labels[0], v0.x, v0.y - 4);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'right';
  ctx.fillText(labels[1], v1.x - 4, v1.y + 2);
  ctx.textAlign = 'left';
  ctx.fillText(labels[2], v2.x + 4, v2.y + 2);

  function baryToPixel(p0, p1, p2) {
    return {
      x: p0 * v0.x + p1 * v1.x + p2 * v2.x,
      y: p0 * v0.y + p1 * v1.y + p2 * v2.y,
    };
  }

  const params = tabState.getPanelParams();
  const ctxLen = params.contextLength;

  if (mixtureMode && mixtureData) {
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      const pc = mixtureData.perComponent[i];
      const trajectories = pc[dataKey];
      if (!trajectories || trajectories.length === 0) continue;
      const dim = trajectories[0].length / ctxLen;
      ctx.fillStyle = componentColor(i);
      ctx.globalAlpha = Math.max(0.3, activeComponents[i] ? activeComponents[i].weight : 0.5);
      for (let b = 0; b < trajectories.length; b++) {
        const traj = trajectories[b];
        for (let t = 0; t < ctxLen; t++) {
          const pt = baryToPixel(traj[t * dim], traj[t * dim + 1], traj[t * dim + 2]);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  } else {
    const trajectories = currentData[dataKey];
    if (!trajectories || trajectories.length === 0) return;
    const dim = trajectories[0].length / ctxLen;
    ctx.fillStyle = accent;
    for (let b = 0; b < trajectories.length; b++) {
      const traj = trajectories[b];
      for (let t = 0; t < ctxLen; t++) {
        const pt = baryToPixel(traj[t * dim], traj[t * dim + 1], traj[t * dim + 2]);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// --- 3D Log Observation Probability (rotatable) ---

function logObsProject(lp0, lp1, lp2, cx, cy, cz) {
  // Rodrigues' rotation around k = (1,-2,1)/√6 through centroid (cx,cy,cz)
  const d0 = lp0 - cx, d1 = lp1 - cy, d2 = lp2 - cz;
  const ca = Math.cos(logObsAngle), sa = Math.sin(logObsAngle);
  const s6 = 1 / Math.sqrt(6);
  const k0 = -2 * s6, k1 = s6, k2 = s6;
  const crx = k1 * d2 - k2 * d1;
  const cry = k2 * d0 - k0 * d2;
  const crz = k0 * d1 - k1 * d0;
  const kd = k0 * d0 + k1 * d1 + k2 * d2;
  const r0 = (d0 * ca + crx * sa + k0 * kd * (1 - ca)) + cx;
  const r1 = (d1 * ca + cry * sa + k1 * kd * (1 - ca)) + cy;
  const r2 = (d2 * ca + crz * sa + k2 * kd * (1 - ca)) + cz;
  // Fixed isometric projection
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  return {
    x: (r1 - r2) * cos30,
    y: -r0 + (r1 + r2) * sin30,
  };
}

function wireLogObsDrag(canvas) {
  const onMove = (e) => {
    if (!logObsDragState) return;
    const dx = e.clientX - logObsDragState.startX;
    const sensitivity = Math.PI / 150;
    logObsAngle = logObsDragState.startAngle + dx * sensitivity;
    renderLogObs3DOnly();
  };

  const onUp = () => {
    if (!logObsDragState) return;
    logObsDragState = null;
    canvas.classList.remove('dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  canvas.addEventListener('mousedown', (e) => {
    logObsDragState = { startX: e.clientX, startAngle: logObsAngle };
    canvas.classList.add('dragging');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  canvas.addEventListener('dblclick', () => {
    logObsAngle = 0;
    renderLogObs3DOnly();
  });
}

function renderLogObs3D(canvas, cssW) {
  const { ctx, cssH } = setupCanvas(canvas, cssW);
  const textMuted = getCSSVar('--text-muted');
  const accent = getCSSVar('--accent');
  const border = getCSSVar('--border');
  ctx.clearRect(0, 0, cssW, cssH);

  const params = tabState.getPanelParams();
  const ctxLen = params.contextLength;

  // First pass: compute 3D centroid in log-space
  let sumLp0 = 0, sumLp1 = 0, sumLp2 = 0, ptCount = 0;

  function addToCentroid(trajectories) {
    if (!trajectories || trajectories.length === 0) return;
    const dim = trajectories[0].length / ctxLen;
    for (let b = 0; b < trajectories.length; b++) {
      const traj = trajectories[b];
      for (let t = 0; t < ctxLen; t++) {
        sumLp0 += Math.log(Math.max(traj[t * dim], 1e-15));
        sumLp1 += Math.log(Math.max(traj[t * dim + 1], 1e-15));
        sumLp2 += Math.log(Math.max(traj[t * dim + 2], 1e-15));
        ptCount++;
      }
    }
  }

  if (mixtureMode && mixtureData) {
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      addToCentroid(mixtureData.perComponent[i].predictions);
    }
  } else {
    addToCentroid(currentData.predictions);
  }

  if (ptCount === 0) return;
  const cx = sumLp0 / ptCount, cy = sumLp1 / ptCount, cz = sumLp2 / ptCount;

  // Second pass: project with rotation around centroid and collect 2D bounds
  const allPx = [];
  const allPy = [];

  function collectBounds(trajectories) {
    if (!trajectories || trajectories.length === 0) return;
    const dim = trajectories[0].length / ctxLen;
    for (let b = 0; b < trajectories.length; b++) {
      const traj = trajectories[b];
      for (let t = 0; t < ctxLen; t++) {
        const p = logObsProject(
          Math.log(Math.max(traj[t * dim], 1e-15)),
          Math.log(Math.max(traj[t * dim + 1], 1e-15)),
          Math.log(Math.max(traj[t * dim + 2], 1e-15)),
          cx, cy, cz,
        );
        allPx.push(p.x);
        allPy.push(p.y);
      }
    }
  }

  if (mixtureMode && mixtureData) {
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      collectBounds(mixtureData.perComponent[i].predictions);
    }
  } else {
    collectBounds(currentData.predictions);
  }

  if (allPx.length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < allPx.length; i++) {
    if (allPx[i] < minX) minX = allPx[i];
    if (allPx[i] > maxX) maxX = allPx[i];
    if (allPy[i] < minY) minY = allPy[i];
    if (allPy[i] > maxY) maxY = allPy[i];
  }

  const pad = 24;
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((cssW - pad * 2) / rangeX, (cssH - pad * 2) / rangeY);
  const dataCX = (minX + maxX) / 2;
  const dataCY = (minY + maxY) / 2;

  function toCanvas(px, py) {
    return {
      x: (px - dataCX) * scale + cssW / 2,
      y: -(py - dataCY) * scale + cssH / 2,
    };
  }

  // Draw axis lines from origin (rotated around centroid)
  const origin = logObsProject(0, 0, 0, cx, cy, cz);
  const axisLen = 1.5;
  const axes = [
    { label: 'log o\u2080', end: logObsProject(-axisLen, 0, 0, cx, cy, cz) },
    { label: 'log o\u2081', end: logObsProject(0, -axisLen, 0, cx, cy, cz) },
    { label: 'log o\u2082', end: logObsProject(0, 0, -axisLen, cx, cy, cz) },
  ];

  const oCanv = toCanvas(origin.x, origin.y);
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.5;
  ctx.font = getFont(9);
  ctx.fillStyle = textMuted;
  for (const axis of axes) {
    const eCanv = toCanvas(axis.end.x, axis.end.y);
    ctx.beginPath();
    ctx.moveTo(oCanv.x, oCanv.y);
    ctx.lineTo(eCanv.x, eCanv.y);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(axis.label, eCanv.x, eCanv.y - 4);
  }

  // Draw data points
  if (mixtureMode && mixtureData) {
    for (let i = 0; i < mixtureData.perComponent.length; i++) {
      if (!componentVisible[i]) continue;
      const pc = mixtureData.perComponent[i];
      if (!pc.predictions || pc.predictions.length === 0) continue;
      const dim = pc.predictions[0].length / ctxLen;
      ctx.fillStyle = componentColor(i);
      ctx.globalAlpha = Math.max(0.3, activeComponents[i] ? activeComponents[i].weight : 0.5);
      for (let b = 0; b < pc.predictions.length; b++) {
        const traj = pc.predictions[b];
        for (let t = 0; t < ctxLen; t++) {
          const p = logObsProject(
            Math.log(Math.max(traj[t * dim], 1e-15)),
            Math.log(Math.max(traj[t * dim + 1], 1e-15)),
            Math.log(Math.max(traj[t * dim + 2], 1e-15)),
            cx, cy, cz,
          );
          const c = toCanvas(p.x, p.y);
          ctx.beginPath();
          ctx.arc(c.x, c.y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  } else {
    const trajectories = currentData.predictions;
    if (!trajectories || trajectories.length === 0) return;
    const dim = trajectories[0].length / ctxLen;
    ctx.fillStyle = accent;
    for (let b = 0; b < trajectories.length; b++) {
      const traj = trajectories[b];
      for (let t = 0; t < ctxLen; t++) {
        const p = logObsProject(
          Math.log(Math.max(traj[t * dim], 1e-15)),
          Math.log(Math.max(traj[t * dim + 1], 1e-15)),
          Math.log(Math.max(traj[t * dim + 2], 1e-15)),
          cx, cy, cz,
        );
        const c = toCanvas(p.x, p.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
