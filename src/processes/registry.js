import { mess3 } from './mess3.js';

const processes = new Map();
processes.set('mess3', mess3);

export function getProcess(name) {
  const p = processes.get(name);
  if (!p) throw new Error(`Unknown process: ${name}`);
  return p;
}

export function listProcesses() {
  return Array.from(processes.values()).map(p => ({ name: p.name, label: p.label }));
}
