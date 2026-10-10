<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { debounce } from '../composables/useStorage';
import type { LetterTemplate } from '../letterTypes';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES, DEFAULT_QUESTION_GUIDANCE, LETTER_TEMPLATE_CONTEXT_MAX_LENGTH } from '../composables/motivationLetters';
import { useToasts, useToastWatch } from '../composables/useToasts';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import { useDesktopSidebar } from '../composables/desktopSidebar';

const props = withDefaults(defineProps<{ userId: string; lang?: string; sidebarActive?: boolean }>(), { sidebarActive: true });
const desktopSidebar = useDesktopSidebar();
const sidebarControlsVisible = computed(() => desktopSidebar.value && props.sidebarActive);
const emit = defineEmits<{ changed: [] }>();
const templates = ref<LetterTemplate[]>([]);
const selectedId = ref('');
const defaultId = ref('');
const form = ref<LetterTemplate | null>(null);
const message = ref('');
const error = ref('');
const validationError = ref('');
const importInput = ref<HTMLInputElement | null>(null);
const isImporting = ref(false);
const saveStatus = ref<'saved' | 'saving' | 'error'>('saved');
let editingOwner = props.userId;
let importGeneration = 0;
let disposed = false;
let replacingForm = false;
let dirty = false;
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const { notify } = useToasts();
useToastWatch(() => message.value, { tone: 'success' });
useToastWatch(() => error.value, { tone: 'error' });
const announceSaved = debounce(() => {
  notify({ message: text('All changes saved locally', 'Alle Änderungen lokal gespeichert'), tone: 'success', key: 'letter-template-autosave' });
}, 1500);
const applicantNamePlaceholder = '{{APPLICANT_NAME}}';
const repository = () => createLetterRepository(localStorage, editingOwner);
function select(id: string) {
  if (!flushSave()) return;
  selectedId.value = id;
  const selected = templates.value.find((item) => item.id === id);
  replaceForm(selected ? JSON.parse(JSON.stringify(selected)) : null);
}
function selectFromInput(event: Event) {
  const input = event.target as HTMLSelectElement;
  select(input.value);
  input.value = selectedId.value;
}
function reload() {
  try {
    templates.value = repository().listTemplates();
    defaultId.value = repository().defaultTemplate()?.id || '';
    select(templates.value.find((item) => item.id === selectedId.value)?.id || defaultId.value);
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function replaceForm(value: LetterTemplate | null) {
  replacingForm = true; form.value = value; validationError.value = ''; replacingForm = false;
}
function create() {
  if (!flushSave()) return;
  replaceForm({ ...DEFAULT_LETTER_TEMPLATES[0]!, id: crypto.randomUUID(), name: text('New letter template', 'Neue Briefvorlage'), revision: 1 });
  selectedId.value = ''; message.value = ''; dirty = true;
  save();
}
function setDefault() {
  if (!flushSave()) return;
  try {
    error.value = '';
    repository().setDefaultTemplate(selectedId.value);
    defaultId.value = selectedId.value;
    emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    message.value = text('Default letter selected. New applications will use this template.', 'Standardbrief ausgewählt. Neue Bewerbungen verwenden diese Vorlage.');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function save(): boolean {
  if (!form.value || !dirty) return true;
  if (!form.value.name.trim() || !form.value.structure.trim() || !form.value.tone.trim()) {
    validationError.value = text('Enter a template name, structure and tone to save your changes.', 'Zum Speichern Vorlagenname, Struktur und Tonalität eingeben.');
    saveStatus.value = 'error';
    return false;
  }
  validationError.value = '';
  try {
    error.value = '';
    const saved = repository().saveTemplate(form.value);
    dirty = false;
    selectedId.value = saved.id;
    replacingForm = true;
    form.value.revision = saved.revision; form.value.updatedAt = saved.updatedAt;
    replacingForm = false;
    templates.value = repository().listTemplates();
    defaultId.value = repository().defaultTemplate()?.id || '';
    saveStatus.value = 'saved';
    announceSaved();
    emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    saveStatus.value = 'error';
    return false;
  }
}
const saveLater = debounce(save, 250);
function flushSave() { saveLater.cancel(); return save(); }
watch(form, () => {
  if (replacingForm) return;
  announceSaved.cancel();
  dirty = true; saveStatus.value = 'saving'; message.value = '';
  saveLater();
}, { deep: true, flush: 'sync' });
watch(() => props.userId, (id) => {
  importGeneration++; isImporting.value = false;
  const saved = flushSave();
  announceSaved.cancel();
  editingOwner = id; dirty = false; selectedId.value = ''; message.value = '';
  replaceForm(null);
  if (saved) { error.value = ''; saveStatus.value = 'saved'; }
  reload();
}, { immediate: true });
onMounted(() => window.addEventListener('pagehide', flushSave));
onBeforeUnmount(() => { disposed = true; importGeneration++; flushSave(); announceSaved.cancel(); window.removeEventListener('pagehide', flushSave); });
function download() {
  if (!flushSave()) return;
  try {
    const url = URL.createObjectURL(new Blob([repository().exportTemplates()], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'letter-templates.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { error.value = String(cause); }
}
async function importLibrary(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file || isImporting.value || disposed || !flushSave()) return;
  const user = props.userId;
  const token = ++importGeneration;
  const current = () => !disposed && token === importGeneration && user === props.userId;
  isImporting.value = true; error.value = ''; message.value = '';
  try {
    const raw = await file.text();
    if (!current() || !flushSave()) return;
    repository().importTemplates(raw); reload(); emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    message.value = text('Templates imported as new copies.', 'Vorlagen als neue Kopien importiert.');
  } catch (cause) {
    if (current()) error.value = text('The library could not be imported. Select the file again to retry. ', 'Die Bibliothek konnte nicht importiert werden. Zum Wiederholen die Datei erneut auswählen. ') + (cause instanceof Error ? cause.message : String(cause));
  }
  finally { if (current()) isImporting.value = false; }
}
</script>

<template>
  <section class="letter-templates">
    <div class="template-heading">
      <p class="app-hint">{{ text('Reusable structure, research interests and drafting guidance. Each application inherits fonts, colors and margins from its assigned CV.', 'Wiederverwendbare Struktur, Forschungsinteressen und Entwurfshinweise. Schriftarten, Farben und Ränder folgen dem zugewiesenen Lebenslauf.') }}</p>
    </div>
    <div class="template-layout" :class="{ 'template-layout--sidebar': sidebarControlsVisible }">
      <DesktopSidebarPortal area="major" :active="sidebarActive">
      <aside class="template-library-controls" :aria-label="text('Letter template library', 'Briefvorlagenbibliothek')">
        <button type="button" @click="create">{{ text('New template', 'Neue Vorlage') }}</button>
        <label>{{ text('Template', 'Vorlage') }}<select :value="selectedId" @change="selectFromInput">
          <option v-if="!selectedId" value="" disabled>{{ text('New template', 'Neue Vorlage') }}</option>
          <option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }} · {{ text('Revision', 'Revision') }} {{ template.revision }}{{ template.id === defaultId ? ' · ' + text('Default', 'Standard') : '' }}</option>
        </select></label>
        <p v-if="form" class="template-selection-details">{{ text('Revision', 'Revision') }} {{ form.revision }} · {{ form.maxWords }} {{ text('words', 'Wörter') }}</p>
        <button type="button" :disabled="!selectedId || selectedId === defaultId" @click="setDefault">{{ selectedId && selectedId === defaultId ? text('Default letter', 'Standardbrief') : text('Set as default letter', 'Als Standardbrief festlegen') }}</button>
        <p class="template-selection-details app-hint">{{ text('The default is selected automatically for new applications on this device.', 'Der Standardbrief wird auf diesem Gerät automatisch für neue Bewerbungen ausgewählt.') }}</p>
        <div class="template-library-actions"><button type="button" @click="download">{{ text('Export library', 'Bibliothek exportieren') }}</button><button type="button" :disabled="isImporting" @click="importInput?.click()">{{ isImporting ? text('Importing…', 'Importieren…') : text('Import library', 'Bibliothek importieren') }}</button></div>
        <p v-if="isImporting" class="template-selection-details" role="status">{{ text('Reading the template library…', 'Vorlagenbibliothek wird gelesen…') }}</p>
        <input ref="importInput" hidden type="file" accept=".json,application/json" :disabled="isImporting" @change="importLibrary" />
      </aside>
      </DesktopSidebarPortal>
      <form v-if="form" class="template-form" @submit.prevent="flushSave" @focusout="flushSave">
        <p v-if="validationError" class="app-hint" role="alert">{{ validationError }}</p>
        <label>{{ text('Template name', 'Vorlagenname') }}<input v-model="form.name" required maxlength="120" /></label>
        <div class="template-form-row"><label>{{ text('Default language', 'Standardsprache') }}<select v-model="form.language"><option value="en">English</option><option value="de">Deutsch</option></select></label><label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="form.maxWords" type="number" min="50" max="2000" required /></label></div>
        <label>{{ text('Subject instructions', 'Hinweise zum Betreff') }}<textarea v-model="form.subjectInstructions" rows="3" maxlength="1000" /><span class="field-description app-hint">{{ text('Describe how to name the position and include a tender reference when available.', 'Beschreiben Sie, wie die Stelle benannt und eine vorhandene Ausschreibungsreferenz aufgenommen werden soll.') }}</span></label>
        <label>{{ text('Salutation instructions', 'Hinweise zur Anrede') }}<textarea v-model="form.salutationInstructions" rows="3" maxlength="1000" /><span class="field-description app-hint">{{ text('Describe how to choose the recipient from the tender and how to greet them if no contact is named.', 'Beschreiben Sie, wie der Empfänger aus der Ausschreibung gewählt und ohne genannten Kontakt angesprochen werden soll.') }}</span></label>
        <label>{{ text('Structure and sections', 'Struktur und Abschnitte') }}<textarea v-model="form.structure" rows="8" required maxlength="16000" /></label>
        <label>{{ text('Closing instructions', 'Hinweise zum Abschluss') }}<textarea v-model="form.closingInstructions" rows="3" maxlength="1000" /><span class="field-description app-hint">{{ text(`Describe the closing invitation, sign-off and signature. Use ${applicantNamePlaceholder} for the private name.`, `Beschreiben Sie die abschließende Einladung, Grußformel und Unterschrift. Verwenden Sie ${applicantNamePlaceholder} für den privaten Namen.`) }}</span></label>
        <label>{{ text('Tone and writing guidance', 'Tonalität und Schreibhinweise') }}<textarea v-model="form.tone" rows="4" maxlength="1000" required /></label>
        <label>{{ text('Main research interests (optional)', 'Zentrale Forschungsinteressen (optional)') }}<textarea v-model="form.researchInterests" rows="5" :maxlength="LETTER_TEMPLATE_CONTEXT_MAX_LENGTH" /><span class="field-description app-hint">{{ text('Describe the research topics and questions that genuinely interest you, including interests not yet reflected in your CV. They enrich the motivation alongside your experience and the opportunity. Use the relevant interests selectively; the letter need not cover them all. Interests do not establish prior experience or qualifications.', 'Beschreiben Sie Forschungsthemen und Fragestellungen, die Sie wirklich interessieren, auch wenn sie noch nicht im Lebenslauf erscheinen. Sie ergänzen Ihre Erfahrungen und die Ausschreibung als Grundlage der Motivation. Relevante Interessen werden gezielt ausgewählt; der Brief muss nicht alle abdecken. Interessen sind kein Nachweis für Vorerfahrung oder Qualifikationen.') }}</span></label>
        <label>{{ text('Questions and context to ask for (optional)', 'Rückfragen und gewünschter Kontext (optional)') }}<textarea v-model="form.questionGuidance" rows="6" :maxlength="LETTER_TEMPLATE_CONTEXT_MAX_LENGTH" /><span class="field-description app-hint">{{ text('Explain when a question would improve a draft or refinement and what context to ask for. For example, ask about required or beneficial qualifications without CV evidence, then request a relevant example or an honest learning interest. Questions should add value, avoid repeating answered questions and never assume missing experience.', 'Beschreiben Sie, wann eine Rückfrage einen Entwurf oder eine Überarbeitung verbessert und welcher Kontext erfragt werden soll. Zum Beispiel: nach geforderten oder vorteilhaften Qualifikationen ohne Lebenslaufnachweis fragen und um ein relevantes Beispiel oder ehrliches Lerninteresse bitten. Fragen sollen einen Mehrwert bieten, beantwortete Fragen nicht wiederholen und fehlende Erfahrung nicht unterstellen.') }}</span></label>
        <button class="template-guidance-example" type="button" @click="form.questionGuidance = DEFAULT_QUESTION_GUIDANCE">{{ text('Use missing-requirements question example', 'Beispielfragen zu fehlenden Anforderungsnachweisen verwenden') }}</button>
        <label>{{ text('Example letter (optional)', 'Beispielbrief (optional)') }}<textarea v-model="form.exampleText" rows="8" maxlength="20000" /><span class="field-description app-hint">{{ text('Use an earlier letter to guide wording, style and structure. Its claims are not evidence about the applicant. Mark confidential details before sharing.', 'Ein früherer Brief kann Wortwahl, Stil und Struktur vorgeben. Seine Aussagen sind keine Nachweise über die bewerbende Person. Markieren Sie vertrauliche Details vor dem Teilen.') }}</span></label>
        <p class="template-hint app-hint">{{ text('Templates stay on this device until included in an explicitly published drafting context.', 'Vorlagen bleiben auf diesem Gerät, bis sie ausdrücklich in einem Entwurfskontext veröffentlicht werden.') }}</p>
      </form>
    </div>
  </section>
</template>

<style scoped>
.letter-templates{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;box-sizing:border-box;overflow:hidden;padding:0;color:var(--ui-text);background:transparent;font-family:var(--font-ui,system-ui)}
.template-heading{display:flex;flex:0 0 auto;justify-content:space-between;gap:20px;align-items:start;margin-bottom:20px}
.letter-templates h2{font:700 22px/1.3 system-ui;text-transform:none;letter-spacing:0;margin:0 0 8px;color:var(--ui-text)}
.letter-templates p,.template-library-controls p{margin:0;color:var(--ui-muted);font-size:13px;line-height:1.6}
.field-description{font-size:12px;font-weight:400;color:var(--ui-muted);line-height:1.5}
.letter-templates :is(button,input,select,textarea),.template-library-controls :is(button,input,select){font:inherit;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-control);color:var(--ui-text);padding:10px 12px}
.letter-templates button,.template-library-controls button{cursor:pointer;font-size:13px;font-weight:600}
button:hover:not(:disabled){background:var(--ui-surface-hover)}
button:disabled{opacity:.55;cursor:default}
.letter-templates :is(button,input,select,textarea):focus-visible,.template-library-controls :is(button,input,select):focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.template-layout{display:grid;flex:1 1 auto;min-height:0;min-width:0;overflow:hidden;grid-template-columns:minmax(180px,240px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:24px}
.template-layout--sidebar{grid-template-columns:minmax(0,1fr)}
aside{min-width:0;align-self:start;display:grid;gap:12px}
.template-library-controls .template-selection-details{font-size:11px}
.template-library-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.template-library-actions button{font-size:11px;padding:8px}
.template-form{display:grid;align-content:start;gap:18px;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;}
.letter-templates label,.template-library-controls label{display:grid;gap:7px;font:600 12px/1.4 system-ui;color:var(--ui-text)}
.letter-templates :is(input,select,textarea),.template-library-controls :is(input,select){font:400 14px/1.5 var(--font-ui);min-width:0;width:100%;box-sizing:border-box}
textarea{resize:vertical}
.template-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.template-hint{font-size:12px}
@media(max-width:700px){.template-layout{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);gap:18px}.template-heading{flex-direction:column;gap:10px;margin-bottom:14px}.template-form-row{grid-template-columns:1fr}.template-library-actions{margin-top:0}.template-form{max-width:none}}
@media(max-width:760px){.letter-templates :is(input,select,textarea),.template-library-controls :is(input,select){font-size:16px}.letter-templates button,.template-library-controls button{min-height:44px}}
</style>
