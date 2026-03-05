// Tab state: manages explore and compound tabs for the detail panel.
// Replaces the mixture-state.js singleton with a proper tabbed architecture.

let tabs = [];
let activeTabId = null;
let nextId = 1;
const listeners = [];

let panelParams = { contextLength: 256, batchSize: 64, seed: 42 };
let processName = null;

function notify(reason) {
  const event = { reason };
  for (const cb of listeners) cb(event);
}

// --- Weight utilities (absorbed from mixture-state.js) ---

function normalizeWeights(components) {
  const n = components.length;
  if (n === 0) return;
  const uniform = 1 / n;
  for (const c of components) c.weight = uniform;
}

// --- Tab lifecycle ---

export function createExploreTab(point) {
  // Find existing explore tab and reuse it
  const existing = tabs.find(t => t.type === 'explore');
  if (existing) {
    existing.point = { ...point };
    existing.cachedData = null;
    activeTabId = existing.id;
    notify('tab-switch');
    return existing.id;
  }

  const tab = {
    id: nextId++,
    type: 'explore',
    point: { ...point },
    cachedData: null,
  };
  tabs.push(tab);
  activeTabId = tab.id;
  notify('tab-created');
  return tab.id;
}

export function createCompoundTab(point) {
  const component = { ...point, weight: 1.0 };
  const tab = {
    id: nextId++,
    type: 'compound',
    components: [component],
    viewMode: 'mix',
    componentVisible: [true],
    soloIndex: -1,
    cachedData: null,
  };
  tabs.push(tab);
  activeTabId = tab.id;
  notify('tab-created');
  return tab.id;
}

export function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  tabs.splice(idx, 1);

  if (activeTabId === id) {
    // Switch to most recent remaining tab
    activeTabId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
  }
  notify('tab-closed');
}

export function getTab(id) {
  return tabs.find(t => t.id === id) || null;
}

export function getTabs() {
  return tabs.slice();
}

export function getActiveTab() {
  if (activeTabId === null) return null;
  return tabs.find(t => t.id === activeTabId) || null;
}

export function getActiveTabId() {
  return activeTabId;
}

export function hasOpenTabs() {
  return tabs.length > 0;
}

// --- Tab switching ---

export function activateTab(id) {
  if (activeTabId === id) return;
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;
  activeTabId = id;
  notify('tab-switch');
}

// --- Explore mutations ---

export function updateExplorePoint(point) {
  const tab = getActiveTab();
  if (!tab || tab.type !== 'explore') return;
  tab.point = { ...point };
  tab.cachedData = null;
  notify('data-change');
}

// --- Compound mutations ---

export function addComponent(tabId, point) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  tab.components.push({ ...point, weight: 0 });
  normalizeWeights(tab.components);
  tab.componentVisible.push(true);
  if (tab.soloIndex >= 0) {
    // Adding a component while soloed: keep new component hidden
    tab.componentVisible[tab.componentVisible.length - 1] = false;
  }
  tab.cachedData = null;

  // Activate this tab if not already active
  if (activeTabId !== tabId) {
    activeTabId = tabId;
  }
  notify('data-change');
}

export function removeComponent(tabId, index) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  if (index < 0 || index >= tab.components.length) return;

  tab.components.splice(index, 1);
  tab.componentVisible.splice(index, 1);

  // Adjust solo index
  if (tab.soloIndex === index) {
    tab.soloIndex = -1;
    tab.componentVisible.fill(true);
  } else if (tab.soloIndex > index) {
    tab.soloIndex--;
  }

  if (tab.components.length > 0) {
    normalizeWeights(tab.components);
  } else {
    // No components left — close the tab
    closeTab(tabId);
    return;
  }
  tab.cachedData = null;
  notify('data-change');
}

export function updateWeight(tabId, index, weight) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  if (index < 0 || index >= tab.components.length) return;
  const n = tab.components.length;
  if (n < 2) return;

  weight = Math.max(0.01, Math.min(0.99, weight));
  const oldWeight = tab.components[index].weight;
  const otherSum = 1 - oldWeight;

  tab.components[index].weight = weight;
  const remaining = 1 - weight;

  if (otherSum > 1e-10) {
    const scale = remaining / otherSum;
    for (let i = 0; i < n; i++) {
      if (i !== index) tab.components[i].weight *= scale;
    }
  } else {
    const each = remaining / (n - 1);
    for (let i = 0; i < n; i++) {
      if (i !== index) tab.components[i].weight = each;
    }
  }
  tab.cachedData = null;
  notify('data-change');
}

export function updateComponentPosition(tabId, index, point) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  if (index < 0 || index >= tab.components.length) return;
  Object.assign(tab.components[index], point);
  tab.cachedData = null;
  notify('data-change');
}

export function findNearComponent(tabId, nx, na, threshold = 0.02) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return -1;
  for (let i = 0; i < tab.components.length; i++) {
    const dx = tab.components[i].nx - nx;
    const da = tab.components[i].na - na;
    if (Math.sqrt(dx * dx + da * da) < threshold) return i;
  }
  return -1;
}

export function getWeights(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return new Float64Array(0);
  return new Float64Array(tab.components.map(c => c.weight));
}

// --- Compound view state ---

export function setViewMode(tabId, mode) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  tab.viewMode = mode;
  notify('visibility-change');
}

export function setComponentVisible(tabId, index, visible) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  if (index < 0 || index >= tab.componentVisible.length) return;
  tab.componentVisible[index] = visible;
  if (tab.soloIndex >= 0) tab.soloIndex = -1;
  notify('visibility-change');
}

export function setSoloComponent(tabId, index) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;

  if (tab.soloIndex === index) {
    // Unsolo
    tab.soloIndex = -1;
    tab.componentVisible.fill(true);
  } else {
    tab.soloIndex = index;
    tab.componentVisible.fill(false);
    if (index >= 0 && index < tab.componentVisible.length) {
      tab.componentVisible[index] = true;
    }
  }
  notify('visibility-change');
}

export function resetVisibility(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab || tab.type !== 'compound') return;
  tab.componentVisible = new Array(tab.components.length).fill(true);
  tab.soloIndex = -1;
  notify('visibility-change');
}

// --- Cache ---

export function getCachedData(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  return tab ? tab.cachedData : null;
}

export function setCachedData(tabId, data) {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) tab.cachedData = data;
}

export function invalidateAllCaches() {
  for (const tab of tabs) tab.cachedData = null;
}

// --- Global params ---

export function getPanelParams() {
  return { ...panelParams };
}

export function setPanelParam(name, value) {
  panelParams[name] = value;
  invalidateAllCaches();
  notify('param-change');
}

// --- Process name ---

export function setProcessName(name) {
  if (processName !== name) {
    processName = name;
    invalidateAllCaches();
  }
}

export function getProcessName() {
  return processName;
}

// --- Events ---

export function onChange(callback) {
  listeners.push(callback);
}

export function offChange(callback) {
  const idx = listeners.indexOf(callback);
  if (idx >= 0) listeners.splice(idx, 1);
}
