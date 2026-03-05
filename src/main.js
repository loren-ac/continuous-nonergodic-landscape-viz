import { defaults } from './config.js';
import { getProcess } from './processes/registry.js';
import { getMeasure } from './compute/measures.js';
import { computeGrid } from './compute/grid.js';
import { LandscapeRenderer } from './render/landscape.js';
import { initControls, updateMeasureParams, showRefInfo, hideRefInfo, wireRunButton, setRunState, setVarToggleVisible } from './ui/controls.js';
import * as hud from './ui/hud.js';
import * as tooltip from './render/tooltip.js';
import { createPanel, hidePanel, isPanelOpen } from './render/detail-panel.js';
import * as tabState from './state/tab-state.js';

// State
let state = { ...defaults };
let renderer;
let currentAbort = null;
let paramsDirty = false;
let isRunning = false;
let shiftHeld = false;
let metaHeld = false;

const refPrompt = document.getElementById('ref-prompt');

function showRefPrompt() {
  refPrompt.style.display = '';
}

function hideRefPrompt() {
  refPrompt.style.display = 'none';
}

function buildMeasureOptions() {
  const measure = getMeasure(state.measure);
  const options = { ...state.measureParams };
  if (measure.needsReference && state.refPoint) {
    options.refX = state.refPoint.x;
    options.refA = state.refPoint.a;
  }
  return options;
}

function enterAwaitingRef() {
  renderer.muteColors();
  renderer.clearReferenceMarker();
  showRefPrompt();
  hud.updateCompute('set ref');
}

function closeDetailPanel() {
  if (isPanelOpen()) {
    hidePanel();
    renderer.clearSelectedMarker();
  }
}

function selectPointByCoords(x, a) {
  if (!renderer.gridData) return;
  const { params, N } = renderer.gridData;
  const process = getProcess(state.process);
  const p0 = process.params[0];
  const p1 = process.params[1];

  // Clamp to parameter range
  x = Math.max(p0.min, Math.min(p0.max, x));
  a = Math.max(p1.min, Math.min(p1.max, a));

  // Find nearest grid point
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < N; i++) {
    const dx = params[i * 2] - x;
    const da = params[i * 2 + 1] - a;
    const dist = dx * dx + da * da;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  const gx = params[bestIdx * 2];
  const ga = params[bestIdx * 2 + 1];
  const nx = (gx - p0.min) / (p0.max - p0.min);
  const na = (ga - p1.min) / (p1.max - p1.min);

  tabState.createExploreTab({ x: gx, a: ga, nx, na });

  const measure = getMeasure(state.measure);
  if (measure.needsReference) {
    state.refPoint = { x: gx, a: ga };
    renderer.setReferenceMarker(nx, na);
    hideRefPrompt();
    showRefInfo(gx, ga);
    recompute();
  }
}

function makeValueEditable(el, onCommit) {
  el.style.cursor = 'default';
  el.addEventListener('dblclick', () => {
    const currentText = el.textContent;
    const isPlaceholder = currentText === '\u2014' || currentText.trim() === '';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = isPlaceholder ? '' : currentText;
    input.style.cssText = `
      width: 52px; background: transparent; border: none;
      border-bottom: 1px solid var(--accent); color: var(--accent);
      font-family: inherit; font-size: inherit; text-align: right;
      outline: none; padding: 0;
    `;
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();

    function commit() {
      const parsed = parseFloat(input.value);
      if (!isNaN(parsed)) {
        el.textContent = parsed.toFixed(4);
        onCommit(parsed);
      } else {
        el.textContent = currentText;
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); input.blur(); }
      if (e.key === 'Escape') { el.textContent = currentText; }
    });
  });
}

async function recompute() {
  // Cancel any in-flight expensive computation
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }

  const process = getProcess(state.process);
  const measure = getMeasure(state.measure);

  // Need reference but don't have one — enter muted state
  if (measure.needsReference && !state.refPoint) {
    if (renderer.gridData) {
      enterAwaitingRef();
    } else {
      hud.updateCompute('set ref');
      showRefPrompt();
    }
    return;
  }

  hideRefPrompt();
  const options = buildMeasureOptions();

  if (measure.isExpensive) {
    // Async path via Web Worker
    const abort = new AbortController();
    currentAbort = abort;
    isRunning = true;
    setRunState('running');
    hud.showProgress();
    const t0 = performance.now();

    try {
      const { computeGridAsync } = await import('./compute/worker-bridge.js');
      const gridData = await computeGridAsync(
        state.process, state.measure, state.resolution, options,
        {
          onProgress: (f) => hud.updateProgress(f),
          signal: abort.signal,
        }
      );

      const elapsed = performance.now() - t0;
      isRunning = false;
      hud.hideProgress();
      setRunState('idle');

      gridData.process = process;
      renderer.setData(gridData, state.colormap);
      renderer.updateHeight(state.heightEnabled, state.heightScale);
      renderer.updatePointSize(state.pointSize);

      if (gridData.variances) {
        renderer.setVarianceSurfaces(gridData);
      }

      hud.updatePoints(gridData.N);
      hud.updateRange(gridData.vMin, gridData.vMax, measure.unit);
      hud.updateCompute(elapsed);
    } catch (e) {
      isRunning = false;
      hud.hideProgress();
      setRunState(paramsDirty ? 'dirty' : 'idle');
      if (e.name !== 'AbortError') {
        console.error('Worker computation failed:', e);
        hud.updateCompute('error');
      }
    }
  } else {
    // Synchronous fast path
    const t0 = performance.now();
    const gridData = computeGrid(process, measure, state.resolution, options);
    const elapsed = performance.now() - t0;

    gridData.process = process;
    renderer.setData(gridData, state.colormap);
    renderer.updateHeight(state.heightEnabled, state.heightScale);
    renderer.updatePointSize(state.pointSize);

    hud.updatePoints(gridData.N);
    hud.updateRange(gridData.vMin, gridData.vMax, measure.unit);
    hud.updateCompute(elapsed);
  }
}

function onRunClick() {
  if (isRunning) {
    // Cancel
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
    }
    isRunning = false;
    hud.hideProgress();
    setRunState(paramsDirty ? 'dirty' : 'idle');
  } else {
    // Run
    paramsDirty = false;
    recompute();
  }
}

function onMeasureChange(measureName) {
  state.measure = measureName;
  state.refPoint = null;
  renderer.clearReferenceMarker();
  hideRefInfo();
  paramsDirty = false;

  // Close detail panel when switching measures
  closeDetailPanel();

  const measure = getMeasure(measureName);

  // Update labels
  tooltip.setLabel(measure.shortLabel);
  hud.setMeasureLabel(measure.shortLabel);

  // Initialize measure-specific params from defaults
  state.measureParams = {};
  if (measure.extraParams) {
    for (const p of measure.extraParams) {
      state.measureParams[p.name] = p.default;
    }
  }

  // Show Var toggle only for expensive (Monte Carlo) measures
  setVarToggleVisible(!!measure.isExpensive);
  if (!measure.isExpensive) {
    renderer.clearVarianceSurfaces();
  }

  // Update dynamic param cells — expensive measures don't auto-recompute on param drag
  if (measure.isExpensive) {
    updateMeasureParams(measure.extraParams, (name, value) => {
      state.measureParams[name] = value;
      paramsDirty = true;
      setRunState('dirty');
    });
    setRunState('idle');
  } else {
    updateMeasureParams(measure.extraParams, (name, value) => {
      state.measureParams[name] = value;
      recompute();
    });
    setRunState('hidden');
  }

  // Auto-run immediately on measure change (first load with defaults)
  recompute();
}

function init() {
  const container = document.getElementById('canvas-container');
  renderer = new LandscapeRenderer(container);

  createPanel();
  wireRunButton(onRunClick);
  tabState.setProcessName(state.process);

  // Click on empty space — no-op for now
  renderer.onClickEmpty = () => {};

  // Resize renderer when detail panel opens/closes
  container.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'right') {
      renderer.resize();
    }
  });

  initControls({
    onResolutionChange(res) {
      state.resolution = res;
      const measure = getMeasure(state.measure);
      if (measure.isExpensive) {
        paramsDirty = true;
        setRunState('dirty');
      } else {
        recompute();
      }
    },
    onColormapChange(cm) {
      state.colormap = cm;
      renderer.updateColors(cm);
    },
    onHeightToggle(enabled) {
      state.heightEnabled = enabled;
      renderer.updateHeight(enabled, state.heightScale);
    },
    onHeightScaleChange(scale) {
      state.heightScale = scale;
      renderer.updateHeight(state.heightEnabled, scale);
    },
    onPointSizeChange(size) {
      state.pointSize = size;
      renderer.updatePointSize(size);
    },
    onCameraPreset(name) {
      renderer.goToPreset(name);
    },
    onThemeToggle(isLight) {
      renderer.updateClearColor(isLight ? 0xb0b0b0 : 0x1a1a1a);
    },
    onMeasureChange,
    onMeasureParamChange(name, value) {
      state.measureParams[name] = value;
      const measure = getMeasure(state.measure);
      if (measure.isExpensive) {
        paramsDirty = true;
        setRunState('dirty');
      } else {
        recompute();
      }
    },
    onReferenceClear() {
      state.refPoint = null;
      hideRefInfo();
      enterAwaitingRef();
    },
    onVarianceToggle(enabled) {
      renderer.toggleVariance(enabled);
    },
  });

  // Keep landscape markers in sync with tab state
  tabState.onChange(() => {
    // Skip marker sync during active drag (avoids flicker)
    if (renderer._dragState && renderer._dragState.active) return;
    renderer.clearSelectedMarker();
    renderer.clearComponentMarkers();
    const active = tabState.getActiveTab();
    if (!active) return;
    if (active.type === 'explore') {
      renderer.setSelectedMarker(active.point.nx, active.point.na);
    } else if (active.type === 'compound' && active.components.length > 0) {
      renderer.setComponentMarkers(active.components);
    }
  });

  // Key tracking
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') shiftHeld = true;
    if (e.key === 'Meta') metaHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') shiftHeld = false;
    if (e.key === 'Meta') metaHeld = false;
  });

  // Click on landscape
  renderer.onClick = (idx, x, a, value) => {
    const process = getProcess(state.process);
    const p0 = process.params[0];
    const p1 = process.params[1];
    const nx = (x - p0.min) / (p0.max - p0.min);
    const na = (a - p1.min) / (p1.max - p1.min);
    const point = { x, a, nx, na };

    if (metaHeld) {
      // Cmd+Click: new compound tab
      tabState.createCompoundTab(point);
    } else if (shiftHeld) {
      // Shift+Click: add/remove from active compound (or create one)
      const active = tabState.getActiveTab();
      if (active && active.type === 'compound') {
        const near = tabState.findNearComponent(active.id, nx, na);
        if (near >= 0) {
          tabState.removeComponent(active.id, near);
        } else {
          tabState.addComponent(active.id, point);
        }
      } else {
        tabState.createCompoundTab(point);
      }
    } else {
      // Regular click: explore tab
      tabState.createExploreTab(point);

      // Also set reference if measure needs it
      const measure = getMeasure(state.measure);
      if (measure.needsReference) {
        state.refPoint = { x, a };
        renderer.setReferenceMarker(nx, na);
        hideRefPrompt();
        showRefInfo(x, a);
        recompute();
      }
    }
  };

  // Drag move: update tab state in real-time during drag
  renderer.onDragMove = (type, index, x, a, nx, na) => {
    const point = { x, a, nx, na };
    const active = tabState.getActiveTab();
    if (type === 'component' && active?.type === 'compound') {
      tabState.updateComponentPosition(active.id, index, point);
    } else if (type === 'selected' && active?.type === 'explore') {
      tabState.updateExplorePoint(point);
    }
  };

  // Drag end: reposition markers
  renderer.onDragEnd = (type, index, x, a, nx, na) => {
    const point = { x, a, nx, na };
    const active = tabState.getActiveTab();
    if (type === 'component' && active?.type === 'compound') {
      tabState.updateComponentPosition(active.id, index, point);
    } else if (type === 'selected' && active?.type === 'explore') {
      tabState.updateExplorePoint(point);
    }
  };

  // Editable coordinate values — double-click to type
  makeValueEditable(document.getElementById('hover-x'), (val) => {
    const a = parseFloat(document.getElementById('hover-a').textContent);
    if (!isNaN(a)) selectPointByCoords(val, a);
  });
  makeValueEditable(document.getElementById('hover-a'), (val) => {
    const x = parseFloat(document.getElementById('hover-x').textContent);
    if (!isNaN(x)) selectPointByCoords(x, val);
  });
  makeValueEditable(document.getElementById('detail-x'), (val) => {
    const a = parseFloat(document.getElementById('detail-a').textContent);
    if (!isNaN(a)) selectPointByCoords(val, a);
  });
  makeValueEditable(document.getElementById('detail-a'), (val) => {
    const x = parseFloat(document.getElementById('detail-x').textContent);
    if (!isNaN(x)) selectPointByCoords(x, val);
  });

  recompute();
  renderer.start();
}

init();
