<script setup lang="ts">
import { ref, watch } from 'vue';
import type { LetterTemplate } from '../letterTypes';
import { createLetterRepository, DEFAULT_LETTER_TEMPLATES } from '../composables/motivationLetters';

const props = defineProps<{ userId: string; lang?: string }>();
const emit = defineEmits<{ changed: [] }>();
const templates = ref<LetterTemplate[]>([]);
const selectedId = ref('');
const form = ref<LetterTemplate | null>(null);
const message = ref('');
const error = ref('');
const importInput = ref<HTMLInputElement | null>(null);
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const applicantNamePlaceholder = '{{APPLICANT_NAME}}';
const repository = () => createLetterRepository(localStorage, props.userId);
function select(id: string) {
  selectedId.value = id;
  const selected = templates.value.find((item) => item.id === id);
  form.value = selected ? JSON.parse(JSON.stringify(selected)) : null;
}
function reload() {
  try { templates.value = repository().listTemplates(); select(templates.value.find((item) => item.id === selectedId.value)?.id || templates.value[0]?.id || ''); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
watch(() => props.userId, () => { error.value = ''; message.value = ''; selectedId.value = ''; reload(); }, { immediate: true });
function create() {
  form.value = { ...DEFAULT_LETTER_TEMPLATES[0], id: crypto.randomUUID(), name: text('New letter template', 'Neue Briefvorlage'), revision: 1 };
  selectedId.value = '';
  message.value = '';
}
function save() {
  if (!form.value) return;
  try {
    error.value = '';
    const saved = repository().saveTemplate(form.value);
    selectedId.value = saved.id; reload(); emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    message.value = text('Template saved locally. Existing letters keep their text.', 'Vorlage lokal gespeichert. Bestehende Briefe behalten ihren Text.');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function download() {
  try {
    const url = URL.createObjectURL(new Blob([repository().exportTemplates()], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'letter-templates.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (cause) { error.value = String(cause); }
}
async function importLibrary(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const user = props.userId;
  try {
    const raw = await file.text();
    if (user !== props.userId) return;
    repository().importTemplates(raw); reload(); emit('changed'); window.dispatchEvent(new Event('cv-letter-templates-updated'));
    message.value = text('Templates imported as new copies.', 'Vorlagen als neue Kopien importiert.');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { input.value = ''; }
}
</script>

<template>
  <section class="letter-templates">
    <div class="template-heading">
      <div><h2>{{ text('Letter templates', 'Briefvorlagen') }}</h2><p>{{ text('Reusable structure and tone. Each application inherits fonts, colors and margins from its assigned CV.', 'Wiederverwendbare Struktur und Tonalität. Schriftarten, Farben und Ränder folgen dem zugewiesenen Lebenslauf.') }}</p></div>
      <button type="button" @click="create">{{ text('New template', 'Neue Vorlage') }}</button>
    </div>
    <p v-if="error" role="alert" class="template-error">{{ error }}</p>
    <p v-if="message" role="status" class="template-notice">{{ message }}</p>
    <div class="template-layout group-panel__scroll-body">
      <aside aria-label="Letter template library">
        <button v-for="template in templates" :key="template.id" type="button" :class="{ selected: selectedId === template.id }" @click="select(template.id)">
          {{ template.name }}<small>{{ text('Revision', 'Revision') }} {{ template.revision }} · {{ template.maxWords }} {{ text('words', 'Wörter') }}</small>
        </button>
        <div class="template-library-actions"><button type="button" @click="download">{{ text('Export library', 'Bibliothek exportieren') }}</button><button type="button" @click="importInput?.click()">{{ text('Import library', 'Bibliothek importieren') }}</button></div>
        <input ref="importInput" hidden type="file" accept=".json,application/json" @change="importLibrary" />
      </aside>
      <form v-if="form" class="template-form" @submit.prevent="save">
        <label>{{ text('Template name', 'Vorlagenname') }}<input v-model="form.name" required maxlength="120" /></label>
        <div class="template-form-row"><label>{{ text('Default language', 'Standardsprache') }}<select v-model="form.language"><option value="en">English</option><option value="de">Deutsch</option></select></label><label>{{ text('Target words', 'Zielwortzahl') }}<input v-model.number="form.maxWords" type="number" min="50" max="2000" required /></label></div>
        <label>{{ text('Subject instructions', 'Hinweise zum Betreff') }}<textarea v-model="form.subjectInstructions" rows="3" maxlength="1000" /><span class="field-description">{{ text('Describe how to name the position and include a tender reference when available.', 'Beschreiben Sie, wie die Stelle benannt und eine vorhandene Ausschreibungsreferenz aufgenommen werden soll.') }}</span></label>
        <label>{{ text('Salutation instructions', 'Hinweise zur Anrede') }}<textarea v-model="form.salutationInstructions" rows="3" maxlength="1000" /><span class="field-description">{{ text('Describe how to choose the recipient from the tender and how to greet them if no contact is named.', 'Beschreiben Sie, wie der Empfänger aus der Ausschreibung gewählt und ohne genannten Kontakt angesprochen werden soll.') }}</span></label>
        <label>{{ text('Structure and sections', 'Struktur und Abschnitte') }}<textarea v-model="form.structure" rows="8" required maxlength="16000" /></label>
        <label>{{ text('Closing instructions', 'Hinweise zum Abschluss') }}<textarea v-model="form.closingInstructions" rows="3" maxlength="1000" /><span class="field-description">{{ text(`Describe the closing invitation, sign-off and signature. Use ${applicantNamePlaceholder} for the private name.`, `Beschreiben Sie die abschließende Einladung, Grußformel und Unterschrift. Verwenden Sie ${applicantNamePlaceholder} für den privaten Namen.`) }}</span></label>
        <label>{{ text('Tone and writing guidance', 'Tonalität und Schreibhinweise') }}<textarea v-model="form.tone" rows="4" maxlength="1000" required /></label>
        <p class="template-hint">{{ text('Templates stay on this device until included in an explicitly published drafting context.', 'Vorlagen bleiben auf diesem Gerät, bis sie ausdrücklich in einem Entwurfskontext veröffentlicht werden.') }}</p>
        <button class="template-primary" type="submit">{{ text('Save template revision', 'Vorlagenrevision speichern') }}</button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.letter-templates{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;box-sizing:border-box;overflow:hidden;padding:0;color:#d1fae5;background:transparent;font-family:var(--font-ui,system-ui)}
.template-heading{display:flex;flex:0 0 auto;justify-content:space-between;gap:20px;align-items:start;margin-bottom:20px}
.letter-templates h2{font:700 22px/1.3 system-ui;text-transform:none;letter-spacing:0;margin:0 0 8px;color:#d1fae5}
.letter-templates p{margin:0;color:#a6c1b9;font-size:13px;line-height:1.6}
.field-description{font-size:12px;font-weight:400;color:#a6c1b9;line-height:1.5}
.letter-templates :is(button,input,select,textarea){font:inherit;border:1px solid #28534e;border-radius:7px;background:#0b1b25;color:#d1fae5;padding:10px 12px}
button{cursor:pointer;font-size:13px;font-weight:600}
button:hover{background:#14352e}
.template-layout{display:grid;flex:1 1 auto;min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;align-content:start;grid-template-columns:minmax(160px,220px) minmax(0,1fr);gap:24px;padding-right:4px}
aside>button{display:block;width:100%;text-align:left;margin-bottom:8px}
aside>button.selected{border-color:#67c8a6;background:#185b4c}
small{display:block;margin-top:4px;color:#a6c1b9;font-size:11px;font-weight:400}
.template-library-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}
.template-library-actions button{font-size:11px;padding:8px}
.template-form{display:grid;gap:18px;max-width:760px}
.letter-templates label{display:grid;gap:7px;font:600 12px/1.4 system-ui;color:#d1fae5}
input,select,textarea{font:400 13px/1.5 system-ui;min-width:0;width:100%;box-sizing:border-box}
textarea{resize:vertical}
.template-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.letter-templates .template-primary{justify-self:start;background:#185b4c;color:#effff6;border-color:#67c8a6}
.letter-templates .template-primary:hover{background:#226e5c}
.template-hint{font-size:12px}
.letter-templates .template-error,.letter-templates .template-notice{flex:0 0 auto;padding:12px;margin-bottom:16px;border-radius:7px;background:#3a1720;color:#fecaca}
.letter-templates .template-notice{background:#10382c;color:#b5e3cb}
@media(max-width:700px){.template-layout{grid-template-columns:1fr;padding-right:0}.template-heading{flex-direction:column;gap:10px;margin-bottom:14px}.template-form-row{grid-template-columns:1fr}}
</style>
