// Worker manager: lazily creates worker, manages job lifecycle

let worker = null;
let jobId = 0;
let activeJob = null;

function getWorker() {
  if (!worker) {
    worker = new Worker('./src/compute/worker.js', { type: 'module' });
  }
  return worker;
}

export function computeGridAsync(processName, measureName, resolution, measureParams, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = ++jobId;

    // Cancel previous job if still running
    if (activeJob) {
      w.postMessage({ type: 'cancel', id: activeJob.id });
      activeJob.reject(new DOMException('Cancelled', 'AbortError'));
      activeJob = null;
    }

    // Listen for abort
    if (signal) {
      signal.addEventListener('abort', () => {
        if (activeJob && activeJob.id === id) {
          w.postMessage({ type: 'cancel', id });
          activeJob = null;
          reject(new DOMException('Aborted', 'AbortError'));
        }
      }, { once: true });
    }

    activeJob = { id, resolve, reject };

    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.id !== id) return; // stale message from old job

      switch (msg.type) {
        case 'progress':
          if (onProgress) onProgress(msg.fraction);
          break;
        case 'result':
          activeJob = null;
          resolve(msg.payload);
          break;
        case 'cancelled':
          activeJob = null;
          reject(new DOMException('Cancelled', 'AbortError'));
          break;
        case 'error':
          activeJob = null;
          reject(new Error(msg.message));
          break;
      }
    };

    w.onerror = (e) => {
      activeJob = null;
      reject(new Error(e.message));
    };

    w.postMessage({
      type: 'compute',
      id,
      payload: { processName, measureName, resolution, measureParams },
    });
  });
}
