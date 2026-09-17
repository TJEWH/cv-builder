export const STORAGE_KEY = 'cv-session';

export function debounce(fn, wait = 250) {
  let timer = null;
  let latestArgs = [];
  const invoke = () => {
    const args = latestArgs;
    latestArgs = [];
    timer = null;
    return fn(...args);
  };
  const debounced = (...args) => {
    latestArgs = args;
    clearTimeout(timer);
    timer = setTimeout(invoke, wait);
  };
  debounced.flush = () => {
    if (timer === null) return undefined;
    clearTimeout(timer);
    return invoke();
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    latestArgs = [];
  };
  return debounced;
}

export function saveLocal(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.warn('saveLocal failed', error);
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('loadLocal failed', error);
    return null;
  }
}
