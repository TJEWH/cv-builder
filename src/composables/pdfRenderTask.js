// DOM measurement cannot run in a Web Worker. Give input/paint a turn between
// short rendering batches instead of draining the entire renderer as microtasks.
function backgroundTurn(signal) {
  if (globalThis.scheduler?.postTask) {
    return globalThis.scheduler.postTask(() => {}, { priority: 'background', signal });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createPdfRenderTask(signal, { now = () => performance.now(), yieldTurn = backgroundTurn, budget = 6 } = {}) {
  const resources = new Set();
  let lastYield = now();
  let disposed = false;
  const check = () => signal?.throwIfAborted();
  const dispose = () => {
    disposed = true;
    for (const node of resources) node.remove();
    resources.clear();
    signal?.removeEventListener('abort', dispose);
  };
  signal?.addEventListener('abort', dispose, { once: true });

  return {
    check,
    // Return nothing in the cheap path; callers can avoid creating a Promise
    // for every node when there is still time left in this batch.
    checkpoint(force = false) {
      check();
      if (!force && now() - lastYield < budget) return;
      return yieldTurn(signal).then(() => {
        check();
        lastYield = now();
      });
    },
    own(node) {
      if (disposed || signal?.aborted) node.remove();
      else resources.add(node);
      return node;
    },
    // Font/image loading can otherwise keep a canceled render waiting forever.
    wait(promise) {
      check();
      if (!signal) return Promise.resolve(promise);
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    },
    dispose,
  };
}

// Every preview surface owns a slot. Invalidating it cancels in-flight work,
// not just the eventual publication of its result.
export function createPreviewRenderSlot() {
  let controller;
  return {
    cancel() {
      controller?.abort();
      controller = undefined;
    },
    start() {
      controller?.abort();
      controller = new AbortController();
      return controller.signal;
    },
  };
}
