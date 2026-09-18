import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { normalizeContentState } from './contentLayout.js';
import { debounce } from './useStorage.js';

const builtInSections = ['header', 'about', 'education', 'jobs', 'languages', 'hobbies'];

export function hasContentSection(state, key) {
  if (builtInSections.includes(key)) return true;
  return [...(state.customSections || []), ...(state.sidebarSections || [])].some((section) => section.id === key);
}

// Alternate versions are separate reactive documents. Only the active document
// is observed by the app's preview; editing another document saves it in place.
export function useSectionVersions({ state, selectedId, configurations, readVersion, saveVersion, onStatus }) {
  const enabled = ref(false);
  const selections = reactive({});
  const records = new Map();
  const revision = ref(0);
  const dirty = new Set();

  function flush() {
    saveLater.cancel();
    for (const id of [...dirty]) {
      const record = records.get(id);
      if (!record) continue;
      if (saveVersion(id, JSON.parse(JSON.stringify(record.data)))) dirty.delete(id);
    }
    onStatus(dirty.size ? 'error' : 'saved');
    return dirty.size === 0;
  }
  const saveLater = debounce(flush, 250);

  function refresh() {
    if (!enabled.value) return;
    const available = new Set(configurations().map(({ id }) => id));
    for (const [id, record] of records) {
      if (!available.has(id) && !dirty.has(id)) {
        record.stop();
        records.delete(id);
      }
    }
    for (const { id } of configurations()) {
      if (id === selectedId() || records.has(id)) continue;
      const saved = readVersion(id);
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) continue;
      const data = JSON.parse(JSON.stringify(saved));
      normalizeContentState(data);
      data.contact ||= {};
      data.completedSections ||= [];
      const document = reactive(data);
      const stop = watch(document, () => {
        dirty.add(id);
        onStatus('saving');
        saveLater();
      }, { deep: true, flush: 'sync' });
      records.set(id, { data: document, stop });
    }
    revision.value += 1;
  }

  const sources = computed(() => {
    revision.value;
    const current = { id: selectedId(), data: state() };
    if (!enabled.value) return [current];
    return [current, ...configurations().filter(({ id }) => id !== current.id && records.has(id))
      .map(({ id }) => ({ id, data: records.get(id).data }))];
  });
  const options = (key) => sources.value.filter(({ data }) => hasContentSection(data, key)).map(({ id }) => ({
    id,
    name: configurations().find((item) => item.id === id)?.name || '',
  }));
  const versionId = (key) => {
    const available = options(key);
    return available.some(({ id }) => id === selections[key]) ? selections[key] : available[0]?.id;
  };
  const sectionState = (key) => sources.value.find(({ id }) => id === versionId(key))?.data || state();
  const select = (key, id) => {
    if (options(key).some((option) => option.id === id)) selections[key] = id;
  };
  const order = (area) => [...new Set(sources.value.flatMap(({ data }) => data[`${area}Order`] || []))];

  function reset() {
    if (!flush()) return false;
    enabled.value = false;
    for (const record of records.values()) record.stop();
    records.clear();
    for (const key of Object.keys(selections)) delete selections[key];
    revision.value += 1;
    return true;
  }

  watch(enabled, (value) => value ? refresh() : flush(), { flush: 'sync' });
  watch(() => configurations().map(({ id }) => id).join('\n'), refresh);
  watch(selectedId, () => { reset(); }, { flush: 'sync' });
  onScopeDispose(() => {
    flush();
    for (const record of records.values()) record.stop();
  });

  return { enabled, options, versionId, sectionState, select, order, flush, reset };
}
