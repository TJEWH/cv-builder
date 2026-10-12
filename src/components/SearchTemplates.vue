<script setup lang="ts">
import { computed, useId, watch } from 'vue';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfiguration } from '../lib/supabaseConfig';
import { supabaseConfiguration } from '../lib/supabase';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faChevronDown, faClock, faCopy, faFileLines, faMagnifyingGlass, faPlus, faSliders } from '@fortawesome/free-solid-svg-icons';
import DesktopSidebarPortal from './DesktopSidebarPortal.vue';
import { useDesktopSidebar } from '../composables/desktopSidebar';
import { useOpportunitySearchTemplates } from '../composables/opportunitySearchTemplates';

const props = withDefaults(defineProps<{ userId: string; client: SupabaseClient | null; lang?: string; sidebarActive?: boolean; configuration?: SupabaseConfiguration }>(), { lang: 'en', sidebarActive: true });
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const desktop = useDesktopSidebar();
const sidebarControlsVisible = computed(() => desktop.value && props.sidebarActive);
const controlsId = useId();
const {
  templates, form, selectedId, status, error, validationError, latestRun,
  scheduleConfirmation, promptPreview, loading, copying, notice,
  select, createBlank, createStarter, duplicate, flushSave, copyPrompt, preparePrompt, retrySave, reloadRemote,
} = useOpportunitySearchTemplates({ userId: () => props.userId, client: () => props.client, lang: () => props.lang, configuration: () => props.configuration ?? supabaseConfiguration });

const statusLabel = computed(() => ({
  saved: text('Saved to Supabase', 'In Supabase gespeichert'),
  saving: text('Saving…', 'Wird gespeichert…'),
  pending: text('Changes pending', 'Änderungen ausstehend'),
  error: text('Changes not saved', 'Änderungen nicht gespeichert'),
}[status.value]));
const copyLabel = computed(() => copying.value ? text('Preparing prompt…', 'Prompt wird vorbereitet…')
  : scheduleConfirmation.value ? text('Copy update prompt', 'Aktualisierungs-Prompt kopieren') : text('Copy setup prompt', 'Einrichtungs-Prompt kopieren'));
const weekdays = computed(() => [
  { value: 1, label: text('Mon', 'Mo'), title: text('Monday', 'Montag') },
  { value: 2, label: text('Tue', 'Di'), title: text('Tuesday', 'Dienstag') },
  { value: 3, label: text('Wed', 'Mi'), title: text('Wednesday', 'Mittwoch') },
  { value: 4, label: text('Thu', 'Do'), title: text('Thursday', 'Donnerstag') },
  { value: 5, label: text('Fri', 'Fr'), title: text('Friday', 'Freitag') },
  { value: 6, label: text('Sat', 'Sa'), title: text('Saturday', 'Samstag') },
  { value: 7, label: text('Sun', 'So'), title: text('Sunday', 'Sonntag') },
]);
const timezoneSuggestions = ['Europe/Berlin', 'Europe/London', 'Europe/Tirane', 'Europe/Zurich', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney', 'UTC'];
function formattedTime(value: string | null | undefined) {
  if (!value) return text('Not recorded', 'Nicht erfasst');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text('Not recorded', 'Nicht erfasst') : new Intl.DateTimeFormat(props.lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function runLabel(value: string) {
  const labels: Record<string, string> = {
    running: text('In progress', 'Läuft'), complete: text('Completed', 'Abgeschlossen'), completed: text('Completed', 'Abgeschlossen'), failed: text('Failed', 'Fehlgeschlagen'),
    partial: text('Partially completed', 'Teilweise abgeschlossen'), saved: text('Results saved', 'Ergebnisse gespeichert'),
  };
  return labels[value] || value;
}
function runSummary(value: unknown) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') return value.message;
  if (value && typeof value === 'object' && 'notes' in value && typeof value.notes === 'string') {
    const summary = value as Record<string, unknown>;
    const counts = ['new', 'updated', 'verified'].every(key => typeof summary[key] === 'number')
      ? text(`${summary.new} new · ${summary.updated} updated · ${summary.verified} verified`, `${summary.new} neu · ${summary.updated} aktualisiert · ${summary.verified} geprüft`) : '';
    return [counts, summary.notes].filter(Boolean).join(' · ');
  }
  return '';
}
function scheduleSummary(value: unknown) {
  if (!value || typeof value !== 'object') return text('Timing not recorded', 'Zeitangaben nicht erfasst');
  const schedule = value as Record<string, unknown>;
  const zone = typeof schedule.timezone === 'string' ? schedule.timezone : '';
  if (schedule.frequency === 'hourly' && typeof schedule.intervalHours === 'number') return text(`Every ${schedule.intervalHours} hours`, `Alle ${schedule.intervalHours} Stunden`) + (zone ? ` · ${zone}` : '');
  if ((schedule.frequency === 'daily' || schedule.frequency === 'weekly') && typeof schedule.time === 'string') {
    const days = schedule.frequency === 'daily' ? text('Daily', 'Täglich') : weekdays.value.filter(day => Array.isArray(schedule.weekdays) && schedule.weekdays.includes(day.value)).map(day => day.label).join(', ');
    return `${days} · ${schedule.time}${zone ? ` · ${zone}` : ''}`;
  }
  return text('Timing not recorded', 'Zeitangaben nicht erfasst');
}
async function selectFromInput(event: Event) {
  const input = event.target as HTMLSelectElement;
  await select(input.value);
  input.value = selectedId.value;
}
function revealInvalidSection(event: Event) {
  const section = (event.target as HTMLElement).closest('details');
  if (section) section.open = true;
}
watch([() => props.sidebarActive, status, loading, () => form.value?.id, () => form.value?.revision], () => {
  if (props.sidebarActive && !loading.value && !copying.value && status.value === 'saved' && form.value && form.value.revision > 0 && !validationError.value) {
    void preparePrompt();
  }
}, { immediate: true, flush: 'post' });
</script>

<template>
  <section class="search-templates" :aria-label="text('Search templates', 'Suchvorlagen')">
    <div class="search-heading">
      <p class="app-hint">{{ text('Define one search per ChatGPT schedule. Copy its setup prompt into ChatGPT to verify the search and create the schedule.', 'Definiere eine Suche pro ChatGPT-Zeitplan. Kopiere den Einrichtungs-Prompt in ChatGPT, um die Suche zu prüfen und den Zeitplan anzulegen.') }}</p>
    </div>
    <div class="search-layout" :class="{ 'search-layout--sidebar': sidebarControlsVisible }">
      <DesktopSidebarPortal area="major" :active="sidebarActive">
        <aside class="search-library" :aria-label="text('Search template library', 'Suchvorlagenbibliothek')">
          <div class="search-library-group">
            <label :for="`${controlsId}-template`">{{ text('Template to edit', 'Vorlage zum Bearbeiten') }}</label>
            <select :id="`${controlsId}-template`" :value="selectedId" :disabled="loading || copying || !templates.length" @change="selectFromInput">
              <option v-if="!selectedId" value="" disabled>{{ text('Choose a template', 'Vorlage auswählen') }}</option>
              <option v-for="item in templates" :key="item.id" :value="item.id">{{ item.name || text('Untitled search', 'Unbenannte Suche') }}</option>
            </select>
            <div class="search-library-actions">
              <button type="button" :disabled="loading || copying" @click="createBlank"><FontAwesomeIcon :icon="faPlus" aria-hidden="true" /><span>{{ text('New blank template', 'Neue leere Vorlage') }}</span></button>
              <button type="button" :disabled="loading || copying || !form" @click="duplicate"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" /><span>{{ text('Duplicate template', 'Vorlage duplizieren') }}</span></button>
            </div>
            <details class="search-starter">
              <summary>{{ text('Start with an example', 'Mit einem Beispiel beginnen') }}</summary>
              <p>{{ text('A funded PhD and applied research search based on your existing search. Edit its criteria for each new schedule.', 'Eine Suche nach finanzierten Promotionen und angewandter Forschung aus deiner bisherigen Suche. Passe die Kriterien für jeden neuen Zeitplan an.') }}</p>
              <button type="button" :disabled="loading || copying" @click="createStarter">{{ text('Use research example', 'Forschungsbeispiel verwenden') }}</button>
            </details>
          </div>
          <div class="search-library-group search-handoff">
            <button class="search-copy-action" type="button" :disabled="loading || copying || !form" @click="copyPrompt"><FontAwesomeIcon :icon="faCopy" aria-hidden="true" /><span>{{ copyLabel }}</span></button>
            <p>{{ text('The latest protocol and saved criteria load from your project at every run. Copying a prompt does not create a schedule.', 'Bei jedem Lauf werden das aktuelle Protokoll und die gespeicherten Kriterien aus deinem Projekt geladen. Das Kopieren eines Prompts erstellt noch keinen Zeitplan.') }}</p>
          </div>
        </aside>
      </DesktopSidebarPortal>

      <div class="search-editor-body">
        <p v-if="loading" class="search-message" role="status">{{ text('Loading search templates…', 'Suchvorlagen werden geladen…') }}</p>
        <div v-if="error" class="search-message search-message--error" role="alert">
          <p>{{ error }}</p>
          <div class="search-recovery-actions">
            <button type="button" :disabled="loading || copying || status === 'saving'" @click="retrySave">{{ text('Retry save', 'Speichern wiederholen') }}</button>
            <button type="button" :disabled="loading || copying || status === 'saving'" @click="reloadRemote">{{ text('Discard local draft and reload', 'Lokalen Entwurf verwerfen und neu laden') }}</button>
          </div>
        </div>
        <p v-if="notice" class="search-message" role="status">{{ notice }}</p>
        <form v-if="form" class="search-form" @submit.prevent="flushSave" @focusout="flushSave" @invalid.capture="revealInvalidSection">
          <div class="search-name-row">
            <label :for="`${controlsId}-name`">{{ text('Template name', 'Vorlagenname') }}<input :id="`${controlsId}-name`" v-model="form.name" required maxlength="200" autocomplete="off" /></label>
            <p class="search-save-status" :class="{ 'search-save-status--pending': status !== 'saved' }" role="status" aria-live="polite">{{ statusLabel }}</p>
          </div>
          <p v-if="validationError" class="search-validation" role="alert">{{ validationError }}</p>

          <details class="search-section" open>
            <summary><FontAwesomeIcon :icon="faMagnifyingGlass" aria-hidden="true" /><span>{{ text('Search criteria', 'Suchkriterien') }}</span><FontAwesomeIcon class="search-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
            <div class="search-section-fields">
              <p class="search-help">{{ text('Fill in what matters for this search. At least one criterion is required; blank fields add no restriction.', 'Trage ein, was für diese Suche wichtig ist. Mindestens ein Kriterium ist erforderlich; leere Felder schränken die Suche nicht ein.') }}</p>
              <label>{{ text('Opportunity types and availability', 'Stellenarten und Verfügbarkeit') }}<textarea v-model="form.criteria.opportunityTypes" rows="3" maxlength="12000" :placeholder="text('PhD, Industrial PhD, applied research; currently open positions…', 'Promotion, Industrial PhD, angewandte Forschung; aktuell offene Stellen…')" /></label>
              <label>{{ text('Topics and methods', 'Themen und Methoden') }}<textarea v-model="form.criteria.topicsAndMethods" rows="6" maxlength="12000" :placeholder="text('Research areas, prototyping, hardware, machine learning, technical evaluation…', 'Forschungsgebiete, Prototyping, Hardware, maschinelles Lernen, technische Evaluation…')" /></label>
            </div>
          </details>
          <details class="search-section">
            <summary><FontAwesomeIcon :icon="faSliders" aria-hidden="true" /><span>{{ text('Location, funding and fit', 'Standort, Finanzierung und Passung') }}</span><FontAwesomeIcon class="search-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
            <div class="search-section-fields">
              <label>{{ text('Locations and languages', 'Standorte und Sprachen') }}<textarea v-model="form.criteria.locationsAndLanguages" rows="4" maxlength="12000" :placeholder="text('Geographic priorities, working languages, location preferences…', 'Geografische Prioritäten, Arbeitssprachen, Standortpräferenzen…')" /></label>
              <label>{{ text('Funding and conditions', 'Finanzierung und Bedingungen') }}<textarea v-model="form.criteria.fundingAndConditions" rows="4" maxlength="12000" :placeholder="text('Funding, salary, contract, start window, eligibility…', 'Finanzierung, Gehalt, Vertrag, Startzeitraum, Zulassungsvoraussetzungen…')" /></label>
              <label>{{ text('Fit and exclusions', 'Passung und Ausschlüsse') }}<textarea v-model="form.criteria.fitAndExclusions" rows="5" maxlength="12000" :placeholder="text('Personal priorities, career direction, unsuitable roles…', 'Persönliche Prioritäten, Karriereziel, ungeeignete Rollen…')" /></label>
            </div>
          </details>
          <details class="search-section">
            <summary><FontAwesomeIcon :icon="faFileLines" aria-hidden="true" /><span>{{ text('Sources and research guidance', 'Quellen und Recherchehinweise') }}</span><FontAwesomeIcon class="search-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
            <div class="search-section-fields">
              <label>{{ text('Sources and query guidance', 'Quellen und Suchanweisungen') }}<textarea v-model="form.criteria.sourcesAndQueries" rows="5" maxlength="12000" :placeholder="text('Preferred sources, keywords, exclusions, queries to keep unchanged…', 'Bevorzugte Quellen, Schlüsselwörter, Ausschlüsse, unverändert zu übernehmende Suchanfragen…')" /></label>
              <label>{{ text('Research and reporting guidance', 'Recherche- und Berichtshinweise') }}<textarea v-model="form.criteria.researchAndReporting" rows="5" maxlength="12000" :placeholder="text('Additional checks, reporting emphasis, notification preferences…', 'Zusätzliche Prüfungen, Berichtsschwerpunkte, Benachrichtigungswünsche…')" /></label>
              <p class="search-help">{{ text('By default, recurring runs report new or materially changed strong matches. Setup verification and actionable failures are always reported.', 'Standardmäßig melden wiederkehrende Läufe neue oder wesentlich geänderte, gut passende Ergebnisse. Einrichtungsprüfung und Fehler mit Handlungsbedarf werden immer gemeldet.') }}</p>
            </div>
          </details>
          <details class="search-section">
            <summary><FontAwesomeIcon :icon="faClock" aria-hidden="true" /><span>{{ text('Schedule', 'Zeitplan') }}</span><FontAwesomeIcon class="search-chevron" :icon="faChevronDown" aria-hidden="true" /></summary>
            <div class="search-section-fields">
              <div class="search-form-row">
                <label>{{ text('Repeat', 'Wiederholung') }}<select v-model="form.schedule.frequency"><option value="hourly">{{ text('Every few hours', 'Alle paar Stunden') }}</option><option value="daily">{{ text('Daily', 'Täglich') }}</option><option value="weekly">{{ text('Weekly', 'Wöchentlich') }}</option></select></label>
                <label v-if="form.schedule.frequency === 'hourly'">{{ text('Interval in hours', 'Intervall in Stunden') }}<input v-model.number="form.schedule.intervalHours" type="number" min="1" max="168" required /></label>
                <label v-else>{{ text('Local time', 'Ortszeit') }}<input v-model="form.schedule.time" type="time" required /></label>
              </div>
              <fieldset v-if="form.schedule.frequency === 'weekly'" class="search-weekdays">
                <legend>{{ text('Days of the week', 'Wochentage') }}</legend>
                <div class="search-day-options"><label v-for="day in weekdays" :key="day.value" :title="day.title"><input v-model="form.schedule.weekdays" type="checkbox" :value="day.value" :aria-label="day.title" /><span>{{ day.label }}</span></label></div>
              </fieldset>
              <label :for="`${controlsId}-timezone`">{{ text('Timezone', 'Zeitzone') }}<input :id="`${controlsId}-timezone`" v-model="form.schedule.timezone" :list="`${controlsId}-timezones`" required maxlength="100" autocomplete="off" :aria-describedby="`${controlsId}-timezone-help`" /></label>
              <datalist :id="`${controlsId}-timezones`"><option v-for="timezone in timezoneSuggestions" :key="timezone" :value="timezone" /></datalist>
              <p :id="`${controlsId}-timezone-help`" class="search-help">{{ text('Use an IANA timezone such as Europe/Berlin. Daily and weekly searches follow local time, including daylight-saving changes.', 'Verwende eine IANA-Zeitzone wie Europe/Berlin. Tägliche und wöchentliche Suchen folgen der Ortszeit einschließlich Zeitumstellung.') }}</p>
              <label class="search-checkbox"><input v-model="form.schedule.runImmediately" type="checkbox" /><span>{{ text('Run immediately to verify', 'Zur Prüfung sofort ausführen') }}</span></label>
              <p class="search-help">{{ form.schedule.runImmediately ? text('ChatGPT verifies the first run before creating the recurring schedule.', 'ChatGPT prüft den ersten Lauf, bevor der wiederkehrende Zeitplan erstellt wird.') : text('The first scheduled run performs verification. No immediate search is requested.', 'Der erste geplante Lauf führt die Prüfung durch. Es wird keine sofortige Suche angefordert.') }}</p>
              <p class="search-help">{{ text('Saved timing changes take effect when the existing schedule next runs. Copy an update prompt to change it sooner.', 'Gespeicherte Zeitänderungen werden beim nächsten Lauf des bestehenden Zeitplans übernommen. Kopiere einen Aktualisierungs-Prompt, um sie früher anzuwenden.') }}</p>
            </div>
          </details>
        </form>
        <div v-else-if="!loading" class="search-empty">
          <h2>{{ text('Create your first search', 'Erstelle deine erste Suche') }}</h2>
          <p>{{ text('Keep a separate template for each scheduled search. All results join the same opportunity list.', 'Verwende für jede geplante Suche eine eigene Vorlage. Alle Ergebnisse erscheinen in derselben Stellenliste.') }}</p>
          <button type="button" :disabled="copying" @click="createBlank"><FontAwesomeIcon :icon="faPlus" aria-hidden="true" />{{ text('New blank template', 'Neue leere Vorlage') }}</button>
        </div>

        <section v-if="form" class="search-activity" :aria-labelledby="`${controlsId}-activity`">
          <div class="search-activity-heading"><h2 :id="`${controlsId}-activity`">{{ text('Recorded activity', 'Erfasste Aktivität') }}</h2><button type="button" :disabled="loading || copying || status !== 'saved'" @click="reloadRemote">{{ text('Refresh', 'Aktualisieren') }}</button></div>
          <dl>
            <div><dt>{{ text('Schedule', 'Zeitplan') }}</dt><dd v-if="scheduleConfirmation">{{ scheduleSummary(scheduleConfirmation.schedule) }}<span class="search-task-id">{{ text('Confirmed', 'Bestätigt') }} · {{ formattedTime(scheduleConfirmation.confirmed_at) }} · {{ scheduleConfirmation.task_id }}</span></dd><dd v-else>{{ text('No confirmed schedule yet', 'Noch kein bestätigter Zeitplan') }}</dd></div>
            <div><dt>{{ text('Latest run', 'Letzter Lauf') }}</dt><dd v-if="latestRun">{{ runLabel(latestRun.status) }} · {{ formattedTime(latestRun.completed_at || latestRun.started_at) }}<span v-if="runSummary(latestRun.summary)" class="search-run-summary">{{ runSummary(latestRun.summary) }}</span></dd><dd v-else>{{ text('No recorded run yet', 'Noch kein Lauf erfasst') }}</dd></div>
          </dl>
        </section>
        <section class="search-prompt-section" :aria-labelledby="`${controlsId}-prompt-label`">
          <label :id="`${controlsId}-prompt-label`" :for="`${controlsId}-prompt`">{{ text('ChatGPT prompt preview', 'ChatGPT-Prompt-Vorschau') }}</label>
          <p class="search-help">{{ text('The preview updates automatically after your changes are saved and project compatibility is checked.', 'Die Vorschau wird nach dem Speichern deiner Änderungen und der Prüfung der Projektkompatibilität automatisch aktualisiert.') }}</p>
          <textarea :id="`${controlsId}-prompt`" class="search-prompt" :value="promptPreview" :placeholder="text('Your saved search prompt will appear here.', 'Der Prompt deiner gespeicherten Suche erscheint hier.')" readonly rows="14" spellcheck="false" />
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-templates{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;overflow:hidden;box-sizing:border-box;color:var(--ui-text);font-family:var(--font-ui,system-ui)}
.search-heading{flex:0 0 auto;margin-bottom:20px;max-width:75ch}
.search-heading p,.search-library p,.search-empty p{margin:0;font-size:13px;line-height:1.6;color:var(--ui-muted)}
.search-layout{display:grid;grid-template-columns:minmax(180px,240px) minmax(0,1fr);grid-template-rows:minmax(0,1fr);gap:24px;min-height:0;min-width:0;flex:1 1 auto;overflow:hidden}
.search-layout--sidebar{grid-template-columns:minmax(0,1fr)}
.search-library{display:grid;gap:24px;min-width:0;align-self:start}
.search-library-group{display:grid;gap:10px;min-width:0}
.search-activity h2,.search-empty h2{margin:0;font:600 14px/1.4 var(--font-ui);color:var(--ui-text)}
.search-library p{font-size:12px;line-height:1.5;overflow-wrap:anywhere}
.search-library-actions{display:grid;gap:8px}
.search-templates :is(button,input,select,textarea),.search-library :is(button,input,select){font:inherit;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-control);color:var(--ui-text);padding:10px 12px;box-sizing:border-box}
.search-templates :is(input,select,textarea),.search-library :is(input,select){width:100%;min-width:0;font:400 14px/1.5 var(--font-ui);caret-color:var(--ui-accent)}
.search-templates textarea{resize:vertical}
.search-templates :is(button,input,select,textarea):focus-visible,.search-library :is(button,input,select,summary):focus-visible{outline:2px solid var(--ui-accent);outline-offset:2px}
.search-templates button,.search-library button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:38px;cursor:pointer;font-size:13px;font-weight:600}
.search-templates button:hover:not(:disabled),.search-library button:hover:not(:disabled){background:var(--ui-surface-hover)}
.search-templates button:disabled,.search-library :is(button,select):disabled{opacity:.55;cursor:default}
.search-library button svg,.search-empty button svg{flex:none;width:14px}
.search-templates label,.search-library label,.search-weekdays legend{display:grid;gap:7px;font:600 12px/1.4 var(--font-ui);color:var(--ui-text)}
.search-library .search-copy-action{border-color:var(--ui-accent-border);color:var(--ui-accent);background:var(--ui-active)}
.search-starter{padding-top:4px;min-width:0}
.search-starter summary{font-size:12px;font-weight:600;color:var(--ui-muted);padding:8px 0;cursor:pointer}
.search-starter p{margin:4px 0 10px}
.search-starter button{width:100%}
.search-handoff{padding-top:20px;border-top:1px solid var(--ui-divider)}
.search-editor-body{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;scrollbar-color:var(--ui-scrollbar) transparent;padding:0 4px 24px 0}
.search-form{min-width:0}
.search-name-row{display:flex;align-items:flex-end;gap:16px;margin-bottom:24px}
.search-name-row>label{flex:1;min-width:0}
.search-save-status{max-width:200px;margin:0 0 11px;font-size:12px;color:var(--ui-accent);line-height:1.4}
.search-save-status--pending{color:var(--ui-muted)}
.search-section{border-top:1px solid var(--ui-divider);min-width:0}
.search-section>summary{display:flex;align-items:center;gap:10px;min-height:48px;padding:8px 16px;box-sizing:border-box;cursor:pointer;list-style:none;font:600 14px/1.5 var(--font-ui)}
.search-section>summary::-webkit-details-marker{display:none}
.search-section>summary::marker{content:''}
.search-section>summary>svg{flex:none;width:16px;color:var(--ui-accent)}
.search-section>summary>.search-chevron{margin-left:auto;width:12px;color:var(--ui-muted)}
.search-section[open]>summary>.search-chevron{transform:rotate(180deg)}
.search-section>summary:hover{color:var(--ui-accent)}
.search-section>summary:focus-visible{outline:2px solid var(--ui-accent);outline-offset:-2px}
.search-section-fields{display:grid;gap:18px;padding:4px 16px 24px;min-width:0}
.search-help{margin:0;color:var(--ui-muted);font-size:12px;line-height:1.6;max-width:75ch}
.search-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.search-weekdays{border:0;padding:0;margin:0;min-width:0}
.search-weekdays legend{padding:0;margin-bottom:8px}
.search-day-options{display:flex;flex-wrap:wrap;gap:8px}
.search-day-options label{display:flex;align-items:center;gap:6px;min-height:38px;padding:0 10px;border:1px solid var(--ui-border);border-radius:7px;cursor:pointer}
.search-day-options label:has(input:checked){border-color:var(--ui-accent-border);background:var(--ui-active);color:var(--ui-accent)}
.search-templates input[type=checkbox]{width:16px;height:16px;margin:0;accent-color:var(--ui-accent);flex:none}
.search-templates .search-checkbox{display:flex;align-items:center;gap:10px;min-height:38px;cursor:pointer}
.search-message{margin:0 0 18px;padding:12px 0;font-size:13px;line-height:1.5;color:var(--ui-text);border-bottom:1px solid var(--ui-divider);overflow-wrap:anywhere}
.search-message p{margin:0}
.search-message--error,.search-validation{color:var(--ui-error-text,#fda4af)}
.search-validation{margin:0 0 20px;font-size:13px;line-height:1.5}
.search-recovery-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.search-activity{border-top:1px solid var(--ui-divider);padding:24px 16px;min-width:0}
.search-activity-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.search-activity-heading button{min-height:32px;font-size:12px;padding:6px 10px}
.search-activity dl{margin:0;display:grid;gap:14px;font-size:13px;line-height:1.5}
.search-activity dl>div{display:grid;grid-template-columns:100px minmax(0,1fr);gap:16px}
.search-activity dt{color:var(--ui-muted)}
.search-activity dd{margin:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}
.search-task-id,.search-run-summary{display:block;color:var(--ui-muted);font-size:12px;margin-top:2px}
.search-prompt-section{display:grid;gap:12px;border-top:1px solid var(--ui-divider);padding:24px 16px;min-width:0}
.search-prompt-section>label{font-size:14px}
.search-templates .search-prompt{font:400 12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.search-empty{display:grid;gap:12px;justify-items:start;max-width:65ch;padding:24px 16px}
.search-empty h2{font-size:18px}
.search-templates ::selection,.search-library ::selection{background:var(--ui-accent);color:var(--ui-shell)}
@media(max-width:760px){
  .search-templates{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:8px}
  .search-heading{margin-bottom:20px}
  .search-layout{display:flex;flex:0 0 auto;flex-direction:column;overflow:visible;gap:28px}
  .search-library{width:100%;gap:20px}
  .search-library-actions{grid-template-columns:1fr 1fr}
  .search-editor-body{overflow:visible;padding:0 0 24px;scrollbar-gutter:auto}
  .search-name-row{flex-direction:column;align-items:stretch;gap:8px}
  .search-save-status{max-width:none;margin:0}
  .search-section>summary{padding:8px 0}
  .search-section-fields{padding:4px 0 24px}
  .search-form-row{grid-template-columns:1fr 1fr;gap:12px}
  .search-activity,.search-prompt-section{padding:24px 0}
  .search-activity dl>div{grid-template-columns:90px minmax(0,1fr);gap:10px}
  .search-templates :is(input,select,textarea),.search-library select{font-size:16px}
  .search-templates button,.search-library button,.search-day-options label,.search-templates .search-checkbox{min-height:44px}
  .search-empty{padding:4px 0 24px}
}
@media(max-width:380px){.search-library-actions,.search-form-row{grid-template-columns:1fr}.search-activity dl>div{grid-template-columns:1fr;gap:3px}}
</style>
