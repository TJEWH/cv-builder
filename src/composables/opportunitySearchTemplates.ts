import { computed, getCurrentScope, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfiguration } from '../lib/supabase';
import type { SupabaseConfiguration } from '../lib/supabaseConfig';
import { SEARCH_CRITERIA_FIELDS, type SearchCriteria, type SearchReadiness, type SearchRun, type SearchSchedule, type SearchScheduleBinding, type SearchTemplate } from '../searchTypes';
import { buildOpportunitySearchSetupPrompt, resolveSearchEnvironment } from './opportunitySearchProtocol';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type SaveStatus = 'pending' | 'saving' | 'saved' | 'error';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fingerprint = (value: SearchTemplate) => JSON.stringify([value.id, value.name.trim(),
  SEARCH_CRITERIA_FIELDS.map(key => value.criteria[key]), value.schedule.frequency, value.schedule.intervalHours,
  value.schedule.weekdays, value.schedule.time, value.schedule.timezone, value.schedule.runImmediately]);
export function emptySearchCriteria(): SearchCriteria {
  return Object.fromEntries(SEARCH_CRITERIA_FIELDS.map(key => [key, ''])) as SearchCriteria;
}
export function defaultSearchSchedule(timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): SearchSchedule {
  return { frequency: 'weekly', intervalHours: 1, weekdays: [1], time: '09:00', timezone, runImmediately: true };
}
export function validateSearchTemplate(template: SearchTemplate, lang = 'en'): string {
  const message = (en: string, de: string) => lang === 'de' ? de : en;
  if (!template.name.trim() || template.name.trim().length > 200) return message('Enter a name of 1–200 characters.', 'Gib einen Namen mit 1–200 Zeichen ein.');
  if (SEARCH_CRITERIA_FIELDS.some(key => typeof template.criteria[key] !== 'string' || template.criteria[key].length > 12000)) return message('Each criterion must contain at most 12,000 characters.', 'Jedes Kriterium darf höchstens 12.000 Zeichen enthalten.');
  if (!SEARCH_CRITERIA_FIELDS.some(key => template.criteria[key].trim().length >= 3)) return message('Add at least one search criterion with three or more characters.', 'Ergänze mindestens ein Suchkriterium mit drei oder mehr Zeichen.');
  const schedule = template.schedule;
  if (!['hourly', 'daily', 'weekly'].includes(schedule.frequency) || !Number.isInteger(schedule.intervalHours) || schedule.intervalHours < 1 || schedule.intervalHours > 168) return message('Choose an interval from 1 to 168 hours.', 'Wähle ein Intervall zwischen 1 und 168 Stunden.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) return message('Choose a valid local time.', 'Wähle eine gültige Ortszeit.');
  if (!Array.isArray(schedule.weekdays) || schedule.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(schedule.weekdays).size !== schedule.weekdays.length || (schedule.frequency === 'weekly' && !schedule.weekdays.length)) return message('Choose at least one weekday for a weekly search.', 'Wähle für eine wöchentliche Suche mindestens einen Wochentag.');
  try { if (!schedule.timezone) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: schedule.timezone }).format(); }
  catch { return message('Enter a valid IANA timezone, such as Europe/Berlin.', 'Gib eine gültige IANA-Zeitzone wie Europe/Berlin ein.'); }
  if (typeof schedule.runImmediately !== 'boolean') return message('Choose whether to verify immediately.', 'Wähle, ob die Suche sofort geprüft werden soll.');
  return '';
}
function readTemplate(value: unknown, owner: string, local = false): SearchTemplate {
  if (!record(value) || typeof value.id !== 'string' || (local ? value.userId : value.user_id) !== owner || typeof value.name !== 'string'
    || !Number.isInteger(value.revision) || Number(value.revision) < (local ? 0 : 1) || !record(value.criteria) || !record(value.schedule)) throw new Error('Invalid saved search template.');
  const criteria = emptySearchCriteria();
  for (const key of SEARCH_CRITERIA_FIELDS) {
    if (value.criteria[key] !== undefined && typeof value.criteria[key] !== 'string') throw new Error('Invalid saved search criteria.');
    criteria[key] = value.criteria[key] as string ?? '';
  }
  const template: SearchTemplate = { id: value.id, userId: owner, name: value.name, revision: Number(value.revision), criteria,
    schedule: clone(value.schedule) as unknown as SearchSchedule,
    createdAt: String((local ? value.createdAt : value.created_at) ?? ''), updatedAt: String((local ? value.updatedAt : value.updated_at) ?? '') };
  // Invalid drafts are intentionally recoverable; structural checks keep the editor safe.
  if (!Array.isArray(template.schedule.weekdays)) throw new Error('Invalid saved search weekdays.');
  return template;
}
export function searchDraftStorageKey(projectUrl: string, owner: string): string {
  return `cv.opportunity-search-drafts.v1:${encodeURIComponent(projectUrl)}:${encodeURIComponent(owner)}`;
}
export interface OpportunitySearchTemplateOptions {
  userId: MaybeRefOrGetter<string | null | undefined>;
  client: MaybeRefOrGetter<SupabaseClient | null>;
  lang?: MaybeRefOrGetter<string>;
  configuration?: MaybeRefOrGetter<SupabaseConfiguration>;
  storage?: DraftStorage;
  clipboard?: { writeText(text: string): Promise<void> };
  autosaveDelay?: number;
}

export function useOpportunitySearchTemplates(options: OpportunitySearchTemplateOptions) {
  const templates = ref<SearchTemplate[]>([]), form = ref<SearchTemplate | null>(null), selectedId = ref('');
  const status = ref<SaveStatus>('saved'), error = ref(''), notice = ref(''), promptPreview = ref('');
  const loading = ref(false), copying = ref(false), latestRun = ref<SearchRun | null>(null), scheduleConfirmation = ref<SearchScheduleBinding | null>(null);
  const configuration = computed(() => options.configuration === undefined ? supabaseConfiguration : toValue(options.configuration));
  const language = () => options.lang === undefined ? 'en' : toValue(options.lang);
  const text = (en: string, de: string) => language() === 'de' ? de : en;
  const validationError = computed(() => form.value ? validateSearchTemplate(form.value, language()) : '');
  const databaseLabel = computed(() => {
    try { const environment = resolveSearchEnvironment(configuration.value); return `${environment.projectRef} · ${new URL(environment.url).host}`; }
    catch { return configuration.value.status === 'ready' ? new URL(configuration.value.url).host : ''; }
  });
  let disposed = false, epoch = 0, suppress = false, timer: ReturnType<typeof setTimeout> | undefined;
  let context: { owner: string; projectUrl: string; client: SupabaseClient; generation: number } | null = null;
  let pendingSave: Promise<boolean> | null = null;
  const drafts = new Map<string, SearchTemplate>(), acknowledged = new Map<string, SearchTemplate>(), conflicts = new Set<string>();
  const controllers = new Set<AbortController>();
  let storage: DraftStorage | undefined = options.storage;
  if (!storage) { try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Cloud saving still works without local storage. */ } }
  function current(c: NonNullable<typeof context>) { return !disposed && context === c && epoch === c.generation; }
  function markRecoveryUnavailable() { notice.value = text('Local draft recovery is unavailable. Keep this tab open until changes save.', 'Lokale Entwurfswiederherstellung ist nicht verfügbar. Lass diesen Tab geöffnet, bis die Änderungen gespeichert sind.'); }
  function persist() {
    if (!context || !storage) return;
    const key = searchDraftStorageKey(context.projectUrl, context.owner);
    try {
      if (!drafts.size) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify({ version: 1, selectedId: selectedId.value, templates: [...drafts.values()] }));
    } catch { markRecoveryUnavailable(); }
  }
  function replaceList(template: SearchTemplate) {
    const index = templates.value.findIndex(item => item.id === template.id);
    if (index < 0) templates.value = [...templates.value, clone(template)];
    else templates.value[index] = clone(template);
  }
  function installForm(template: SearchTemplate | null) {
    suppress = true;
    form.value = template ? clone(template) : null;
    selectedId.value = template?.id ?? '';
    suppress = false;
    promptPreview.value = ''; error.value = '';
    status.value = template && drafts.has(template.id) ? 'pending' : 'saved';
    if (template && conflicts.has(template.id)) { status.value = 'error'; error.value = conflictMessage(); }
  }
  const conflictMessage = () => text('A newer saved revision exists. Your draft is preserved; discard it and reload before editing the newer revision.', 'Eine neuere gespeicherte Version ist vorhanden. Dein Entwurf bleibt erhalten; verwirf ihn und lade die neuere Version zum Bearbeiten.');
  function message(reason: unknown) {
    const code = record(reason) ? reason.code : '';
    if (code === '40001') return conflictMessage();
    if (code === 'PGRST202' || code === '42P01' || code === '42883') return text('Opportunity search setup is incomplete. Apply the opportunity_search.sql upgrade and installed protocol to this project.', 'Die Suchfunktion ist noch nicht eingerichtet. Installiere opportunity_search.sql und das aktuelle Protokoll in diesem Projekt.');
    if (code === '42501' || code === 'PGRST301') return text('Your session cannot access these searches. Sign in again and retry.', 'Deine Sitzung kann auf diese Suchen nicht zugreifen. Melde dich erneut an.');
    return reason instanceof Error ? reason.message : record(reason) && typeof reason.message === 'string' ? reason.message : text('The request failed. Your local draft is preserved.', 'Die Anfrage ist fehlgeschlagen. Dein lokaler Entwurf bleibt erhalten.');
  }
  function dirty() {
    if (suppress || !form.value || !context) return;
    const value = clone(form.value), previous = acknowledged.get(value.id);
    promptPreview.value = ''; notice.value = ''; error.value = conflicts.has(value.id) ? conflictMessage() : '';
    if (previous && fingerprint(value) === fingerprint(previous)) drafts.delete(value.id);
    else drafts.set(value.id, value);
    replaceList(value); persist();
    status.value = conflicts.has(value.id) ? 'error' : pendingSave ? 'saving' : drafts.has(value.id) ? 'pending' : 'saved';
    clearTimeout(timer);
    if (drafts.has(value.id) && !validateSearchTemplate(value, language()) && !conflicts.has(value.id)) timer = setTimeout(() => { void flushSave(); }, options.autosaveDelay ?? 650);
  }
  const stopFormWatch = watch(form, dirty, { deep: true, flush: 'sync' });
  async function activity(c: NonNullable<typeof context>, id: string) {
    const [runs, bindings] = await Promise.all([
      c.client.from('opportunity_search_runs').select('*').eq('user_id', c.owner).eq('search_id', id).order('created_at', { ascending: false }).limit(1),
      c.client.from('opportunity_search_schedule_bindings').select('*').eq('user_id', c.owner).eq('search_id', id).order('confirmed_at', { ascending: false }).limit(1),
    ]);
    if (!current(c) || selectedId.value !== id) return;
    if (runs.error) throw runs.error;
    if (bindings.error) throw bindings.error;
    const run = runs.data?.[0], binding = bindings.data?.[0];
    if (run && (run.user_id !== c.owner || run.search_id !== id)) throw new Error('Invalid search activity owner.');
    if (binding && (binding.user_id !== c.owner || binding.search_id !== id)) throw new Error('Invalid schedule owner.');
    latestRun.value = run ? { ...run, started_at: run.created_at } as SearchRun : null;
    scheduleConfirmation.value = binding ? clone(binding) as SearchScheduleBinding : null;
  }
  async function load(c: NonNullable<typeof context>, preferredId = '') {
    loading.value = true;
    try {
      const saved: SearchTemplate[] = [];
      for (let offset = 0; ; offset += 500) {
        const response = await c.client.from('opportunity_search_templates').select('*').eq('user_id', c.owner).order('updated_at', { ascending: false }).range(offset, offset + 499);
        if (!current(c)) return;
        if (response.error) throw response.error;
        for (const row of response.data ?? []) saved.push(readTemplate(row, c.owner));
        if ((response.data?.length ?? 0) < 500) break;
      }
      acknowledged.clear(); conflicts.clear();
      for (const template of saved) {
        acknowledged.set(template.id, template);
        const draft = drafts.get(template.id);
        if (draft && fingerprint(draft) === fingerprint(template) && template.revision >= draft.revision) drafts.delete(template.id);
        else if (draft && draft.revision !== template.revision) conflicts.add(template.id);
      }
      templates.value = saved.map(template => clone(drafts.get(template.id) ?? template));
      for (const draft of drafts.values()) if (!saved.some(template => template.id === draft.id)) {
        templates.value.push(clone(draft));
        if (draft.revision > 0) conflicts.add(draft.id);
      }
      const chosen = templates.value.find(item => item.id === preferredId) ?? templates.value[0] ?? null;
      installForm(chosen); persist();
      if (chosen) await activity(c, chosen.id);
      if (current(c) && drafts.size) notice.value = text('Recovered local changes are preserved. Save them when ready, or discard and reload.', 'Wiederhergestellte lokale Änderungen bleiben erhalten. Speichere sie oder verwirf sie und lade neu.');
    } catch (reason) {
      if (!current(c)) return;
      if (!form.value && drafts.size) { templates.value = [...drafts.values()].map(clone); installForm(templates.value[0]); }
      error.value = message(reason); if (form.value && drafts.has(form.value.id)) status.value = 'error';
    } finally { if (current(c)) loading.value = false; }
  }
  async function reset() {
    persist(); epoch++; clearTimeout(timer);
    controllers.forEach(controller => controller.abort()); controllers.clear(); pendingSave = null;
    context = null; drafts.clear(); acknowledged.clear(); conflicts.clear(); templates.value = [];
    installForm(null); latestRun.value = null; scheduleConfirmation.value = null; loading.value = false; copying.value = false; notice.value = '';
    const owner = toValue(options.userId), client = toValue(options.client), config = configuration.value;
    if (!owner || !client || config.status !== 'ready') return;
    const c = context = { owner, projectUrl: config.url, client, generation: epoch };
    let preferredId = '';
    if (storage) {
      try {
        const raw = storage.getItem(searchDraftStorageKey(c.projectUrl, owner));
        if (raw) {
          const saved: unknown = JSON.parse(raw);
          if (!record(saved) || saved.version !== 1 || !Array.isArray(saved.templates)) throw new Error('Invalid local search draft.');
          for (const value of saved.templates) { const template = readTemplate(value, owner, true); drafts.set(template.id, template); }
          preferredId = typeof saved.selectedId === 'string' ? saved.selectedId : '';
        }
      } catch { notice.value = text('The local search recovery file could not be read. Saved Supabase templates are still available.', 'Die lokale Wiederherstellungsdatei konnte nicht gelesen werden. Gespeicherte Supabase-Vorlagen sind weiterhin verfügbar.'); }
    }
    await load(c, preferredId);
  }
  const stopContextWatch = watch(() => [toValue(options.userId), toValue(options.client), configuration.value] as const, () => { void reset(); }, { immediate: true, flush: 'sync' });

  async function flushSave(): Promise<boolean> {
    clearTimeout(timer);
    const c = context;
    if (!c || !current(c) || !form.value || loading.value) return false;
    if (pendingSave) { const succeeded = await pendingSave; if (!succeeded || !current(c)) return false; return flushSave(); }
    const snapshot = clone(form.value);
    if (!drafts.has(snapshot.id)) return true;
    if (validateSearchTemplate(snapshot, language())) { status.value = 'pending'; return false; }
    if (conflicts.has(snapshot.id)) { error.value = conflictMessage(); status.value = 'error'; return false; }
    const controller = new AbortController(); controllers.add(controller);
    status.value = 'saving'; error.value = '';
    const task = (async () => {
      try {
        let query = c.client.rpc('save_opportunity_search_template', { p_id: snapshot.id, p_expected_revision: snapshot.revision,
          p_name: snapshot.name.trim(), p_criteria: clone(snapshot.criteria), p_schedule: clone(snapshot.schedule) });
        if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
        const response = await query;
        if (!current(c)) return false;
        if (response.error) throw response.error;
        const saved = readTemplate(Array.isArray(response.data) ? response.data[0] : response.data, c.owner);
        if (saved.id !== snapshot.id || saved.revision !== snapshot.revision + 1 || fingerprint(saved) !== fingerprint(snapshot)) throw new Error('The saved search receipt does not match the submitted revision.');
        acknowledged.set(saved.id, saved);
        if (form.value?.id === saved.id) {
          const editedDuringSave = fingerprint(form.value) !== fingerprint(snapshot);
          suppress = true;
          form.value = editedDuringSave ? { ...clone(form.value), revision: saved.revision, createdAt: saved.createdAt, updatedAt: saved.updatedAt } : clone(saved);
          suppress = false;
          if (editedDuringSave) drafts.set(saved.id, clone(form.value)); else drafts.delete(saved.id);
          replaceList(form.value);
          status.value = editedDuringSave ? 'pending' : 'saved';
        } else { drafts.delete(saved.id); replaceList(saved); }
        persist(); return true;
      } catch (reason) {
        if (!current(c)) return false;
        if (record(reason) && reason.code === '40001') conflicts.add(snapshot.id);
        error.value = message(reason); status.value = 'error'; persist(); return false;
      } finally { controllers.delete(controller); }
    })();
    pendingSave = task;
    const succeeded = await task;
    if (pendingSave === task) pendingSave = null;
    if (!succeeded || !current(c)) return false;
    if (form.value && drafts.has(form.value.id)) return flushSave();
    return true;
  }
  async function select(id: string) {
    if (loading.value || copying.value || id === selectedId.value) return;
    const c = context;
    await flushSave();
    const selected = templates.value.find(item => item.id === id);
    if (!c || !current(c) || !selected) return;
    installForm(drafts.get(id) ?? acknowledged.get(id) ?? selected); latestRun.value = null; scheduleConfirmation.value = null; persist();
    try { await activity(c, id); } catch (reason) { if (current(c) && selectedId.value === id) error.value = message(reason); }
  }
  async function create(template?: SearchTemplate) {
    const c = context;
    if (loading.value || copying.value || !c) return false;
    await flushSave();
    if (!current(c)) return false;
    const now = new Date().toISOString();
    const value: SearchTemplate = template ? { ...clone(template), id: crypto.randomUUID(), userId: c.owner, name: `${template.name} ${text('(copy)', '(Kopie)')}`.slice(0, 200), revision: 0, createdAt: now, updatedAt: now }
      : { id: crypto.randomUUID(), userId: c.owner, name: '', criteria: emptySearchCriteria(), schedule: defaultSearchSchedule(), revision: 0, createdAt: now, updatedAt: now };
    drafts.set(value.id, value); replaceList(value); installForm(value); latestRun.value = null; scheduleConfirmation.value = null; persist();
    if (!validateSearchTemplate(value, language())) await flushSave();
    return true;
  }
  const createBlank = () => create();
  const duplicate = () => form.value ? create(clone(form.value)) : Promise.resolve();
  async function createStarter() {
    const c = context;
    if (!await create() || !c || !current(c)) return;
    if (!form.value || form.value.revision !== 0) return;
    form.value.name = text('Funded PhD and applied research', 'Finanzierte Promotion und angewandte Forschung');
    form.value.criteria = {
      opportunityTypes: text('Currently open, funded PhD, Industrial PhD or applied research positions.', 'Aktuell offene und finanzierte PhD-, Industrial-PhD- oder anwendungsnahe Forschungsstellen.'),
      topicsAndMethods: 'Speech/Voice/Audio, Acoustics, Embedded/Edge AI, Signal Processing, Robotics/Embodied AI, BCI, Audio Interfaces, Vocal Biomarkers. Prototyping, ML, technical evaluation, real hardware and intelligent physical systems.',
      locationsAndLanguages: text('Prefer Scandinavia, then Europe, Japan, Australia/New Zealand, and interesting cooler locations in Southeast Asia or emerging countries. English or German working language.', 'Bevorzuge Skandinavien, dann Europa, Japan, Australien/Neuseeland und interessante kühlere Standorte in Südostasien oder Schwellenländern. Arbeitssprache Englisch oder Deutsch.'),
      fundingAndConditions: text('Solid funding; start around early 2027. Verify funding, salary, contract, duration and eligibility.', 'Solide Finanzierung; Beginn möglichst Anfang 2027. Finanzierung, Gehalt, Vertrag, Dauer und Zulassungsvoraussetzungen prüfen.'),
      fitAndExclusions: text('Prioritize strong technical fit, hands-on research, prototyping and a useful research or industrial R&D career direction.', 'Priorisiere starke technische Passung, praktische Forschung, Prototyping und eine sinnvolle Forschungs- oder industrielle F&E-Laufbahn.'),
      sourcesAndQueries: text('Prefer official vacancy listings and linked application or graduate-school requirements.', 'Bevorzuge offizielle Ausschreibungen und verlinkte Bewerbungs- oder Graduate-School-Vorgaben.'),
      researchAndReporting: text('Check research content and methods, supervisors and contacts with evidenced roles, teaching load, funding and required/optional/conditional documents. Report only new or materially changed strong matches; stay quiet otherwise.', 'Prüfe Forschungsinhalt und Methoden, Betreuer und Ansprechpartner mit belegten Rollen, Lehranteil, Finanzierung sowie erforderliche, optionale und bedingte Unterlagen. Melde nur neue oder wesentlich veränderte starke Treffer; bleibe sonst still.'),
    };
    await flushSave();
  }
  async function reloadRemote() {
    const c = context;
    if (!c || loading.value || copying.value) return;
    clearTimeout(timer); if (pendingSave) await pendingSave; if (!current(c)) return;
    const id = selectedId.value; drafts.delete(id); conflicts.delete(id); persist(); await load(c, id);
  }
  async function prepared(): Promise<string | null> {
    const c = context;
    if (!c || loading.value || !form.value) return null;
    const id = form.value.id;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!await flushSave()) return null;
      if (!current(c) || form.value?.id !== id) return null;
      const saved = clone(acknowledged.get(id) ?? form.value);
      const environment = resolveSearchEnvironment(configuration.value);
      const response = await c.client.rpc('opportunity_search_readiness');
      if (!current(c) || form.value?.id !== id) return null;
      if (response.error) throw response.error;
      const readiness = response.data as SearchReadiness;
      if (!record(readiness) || !readiness.ready || readiness.bootstrap_version !== 1 || typeof readiness.protocol_version !== 'string' || typeof readiness.protocol_hash !== 'string') throw new Error(text('This project needs a compatible opportunity search upgrade and installed protocol before copying a runnable prompt.', 'Dieses Projekt benötigt ein kompatibles Such-Upgrade und ein installiertes Protokoll, bevor ein ausführbarer Prompt kopiert werden kann.'));
      await activity(c, id);
      if (!current(c) || form.value?.id !== id) return null;
      if (drafts.has(id) || saved.revision !== form.value.revision || fingerprint(saved) !== fingerprint(form.value)) continue;
      const prompt = buildOpportunitySearchSetupPrompt({ template: saved, environment, readiness, binding: scheduleConfirmation.value });
      promptPreview.value = prompt; return prompt;
    }
    throw new Error(text('Finish editing, then copy again so the prompt uses one saved revision.', 'Beende die Bearbeitung und kopiere erneut, damit der Prompt eine gespeicherte Version verwendet.'));
  }
  async function preparePrompt() {
    if (copying.value) return null;
    copying.value = true; error.value = ''; notice.value = ''; promptPreview.value = '';
    const c = context;
    try { return await prepared(); }
    catch (reason) { if (c && current(c)) error.value = message(reason); return null; }
    finally { if (c && current(c)) copying.value = false; }
  }
  async function copyPrompt() {
    if (copying.value) return false;
    copying.value = true; error.value = ''; notice.value = ''; promptPreview.value = '';
    const c = context;
    try {
      const prompt = await prepared(); if (!prompt || !c || !current(c)) return false;
      try {
        const clipboard = options.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
        if (!clipboard) throw new Error('Clipboard unavailable');
        await clipboard.writeText(prompt);
        if (current(c)) notice.value = text('Prompt copied. Paste it into ChatGPT to set up or update this search.', 'Prompt kopiert. Füge ihn in ChatGPT ein, um die Suche einzurichten oder zu aktualisieren.');
        return true;
      } catch {
        if (current(c)) notice.value = text('Clipboard access is unavailable. Select and copy the prepared prompt below.', 'Die Zwischenablage ist nicht verfügbar. Wähle den vorbereiteten Prompt unten aus und kopiere ihn.');
        return false;
      }
    } catch (reason) { if (c && current(c)) error.value = message(reason); return false; }
    finally { if (c && current(c)) copying.value = false; }
  }
  function dispose() {
    persist(); disposed = true; epoch++; clearTimeout(timer); controllers.forEach(controller => controller.abort()); controllers.clear(); stopFormWatch(); stopContextWatch();
  }
  async function retrySave() {
    if (!form.value && context) { await load(context); return !error.value; }
    return flushSave();
  }
  if (getCurrentScope()) onScopeDispose(dispose);
  return { templates, form, selectedId, status, error, validationError, databaseLabel, latestRun, scheduleConfirmation, promptPreview, loading, copying, notice,
    select, createBlank, createStarter, duplicate, flushSave, copyPrompt, preparePrompt, retrySave, reloadRemote, dispose };
}
