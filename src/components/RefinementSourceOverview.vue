<script setup lang="ts">
import { computed } from 'vue';
import type { Application } from '../cloudTypes';
import type { ApplicationLetter } from '../letterTypes';
import type { ApplicationCvRecord } from '../composables/applicationCv';
import type { LocalRefinementRequest, RefinementRequestRow } from '../refinementTypes';
import type { ResolvedRefinementSettings } from '../composables/refinementSources';
import { serializeRefinementDraft } from '../composables/refinementSources';

const props = defineProps<{
  application: Application; record: ApplicationCvRecord | null; letter: ApplicationLetter | null; lang: string;
  settings: ResolvedRefinementSettings; prepared: LocalRefinementRequest | null; sourceError: string;
  published: RefinementRequestRow | null; publishedLocal: LocalRefinementRequest | null;
  isCurrentRequest: boolean; status: 'unpublished' | 'current' | 'outdated' | 'unverifiable';
}>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const draft = computed(() => serializeRefinementDraft(props.letter?.working));
const sourceWords = computed(() => (props.prepared?.request.letter.text ?? draft.value.text).trim().split(/\s+/).filter(Boolean).length);
const hasTemplate = computed(() => !!props.letter?.templateSnapshot);
const language = (value: string) => ({ en: 'English', de: 'Deutsch' })[value] || value;
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(props.lang === 'de' ? 'de-DE' : 'en-GB') : text('Not recorded', 'Nicht erfasst');
const origin = (value: string) => value === 'application' ? text('Saved application setting', 'Gespeicherte Bewerbungseinstellung') : text('Frozen template default', 'Standard der gespeicherten Vorlage');
const statusLabel = computed(() => ({
  unpublished: text('Not published yet', 'Noch nicht veröffentlicht'),
  current: text('Up to date — this request will be reused', 'Aktuell — diese Anfrage wird wiederverwendet'),
  outdated: text('Outdated — publish the current sources', 'Veraltet — aktuelle Quellen veröffentlichen'),
  unverifiable: text('Cannot verify on this device', 'Auf diesem Gerät nicht überprüfbar'),
})[props.status]);
</script>

<template>
  <section class="source-overview" :aria-label="text('Refinement sources', 'Quellen der Überarbeitung')">
    <h3>{{ text('Sources to share', 'Zu teilende Quellen') }}</h3>
    <dl class="source-overview__values">
      <dt>CV</dt><dd v-if="record"><strong>{{ record.baseName }}</strong> · {{ text('source revision', 'Quellrevision') }} {{ record.baseRevision }}<small>{{ prepared?.source?.cv.hasApplicationEdits ? text('Application copy with local edits', 'Bewerbungskopie mit lokalen Änderungen') : text('Saved application copy', 'Gespeicherte Bewerbungskopie') }}</small></dd><dd v-else>{{ text('No CV selected', 'Kein CV ausgewählt') }}</dd>
      <dt>{{ text('Motivation letter', 'Motivationsschreiben') }}</dt><dd v-if="!draft.empty"><strong>{{ text('Current working draft', 'Aktuelle Arbeitsfassung') }}</strong> · {{ sourceWords }} {{ text('words', 'Wörter') }}<small>{{ text('Saved', 'Gespeichert') }} {{ date(letter?.updatedAt) }}</small></dd><dd v-else class="source-overview__empty">{{ text('No letter available — create an initial draft.', 'Kein Brief vorhanden — einen ersten Entwurf erstellen.') }}</dd>
      <dt>{{ text('Opportunity context', 'Ausschreibungskontext') }}</dt><dd><strong>{{ String(application.context_json.title || text('Saved opportunity research', 'Gespeicherte Ausschreibungsrecherche')) }}</strong><small>{{ text('Captured', 'Erfasst') }} {{ date(application.context_captured_at) }}</small></dd>
      <dt>{{ text('Template', 'Vorlage') }}</dt><dd>{{ hasTemplate ? settings.setup.template.name : text('No template selected', 'Keine Vorlage ausgewählt') }}<small v-if="hasTemplate">{{ text('Frozen revision', 'Gespeicherte Revision') }} {{ settings.setup.template.revision }}</small></dd>
      <dt>{{ text('Language', 'Sprache') }}</dt><dd>{{ hasTemplate ? language(settings.setup.language) : '—' }}</dd>
      <dt>{{ text('Effective word limit', 'Wirksame Wortgrenze') }}</dt><dd><strong>{{ hasTemplate ? `${settings.setup.maxWords} ${text('words', 'Wörter')}` : '—' }}</strong></dd>
    </dl>
    <details>
      <summary>{{ text('Origins & privacy-filtered content', 'Herkunft & datenschutzgefilterte Inhalte') }}</summary>
      <p v-if="hasTemplate">{{ text('Language:', 'Sprache:') }} {{ origin(settings.provenance.language) }}. {{ text('Word limit:', 'Wortgrenze:') }} {{ origin(settings.provenance.maxWords) }}.</p>
      <p>{{ text('The CV comes from the frozen application copy. The letter uses the complete current working draft. Both are included as context; the selected scope controls which may change.', 'Der CV stammt aus der gespeicherten Bewerbungskopie. Der Brief verwendet die vollständige aktuelle Arbeitsfassung. Beide dienen als Kontext; der gewählte Umfang bestimmt, was geändert werden darf.') }}</p>
      <template v-if="prepared">
        <details><summary>{{ text('CV wording to share', 'Zu teilender CV-Wortlaut') }}</summary><article v-for="field in prepared.request.cv.fields" :key="field.id"><strong>{{ field.label }}</strong><pre>{{ field.text }}</pre></article></details>
        <details><summary>{{ text('Complete letter to share', 'Vollständiger zu teilender Brief') }}</summary><pre>{{ prepared.request.letter.text || text('Empty — request an initial draft.', 'Leer — ersten Entwurf anfordern.') }}</pre></details>
        <details><summary>{{ text('Saved context & writing instructions', 'Gespeicherter Kontext & Schreibhinweise') }}</summary><pre>{{ JSON.stringify(prepared.request.cv.opportunity, null, 2) }}</pre><pre v-if="prepared.request.cv.instructions">{{ prepared.request.cv.instructions }}</pre><p>{{ prepared.request.feedback.length }} {{ text('saved feedback entries included', 'gespeicherte Feedbackeinträge enthalten') }}</p></details>
      </template>
    </details>
    <p v-if="sourceError" class="source-overview__error" role="alert">{{ sourceError }}</p>
    <div class="source-overview__publication">
      <h4>{{ text('Published source', 'Veröffentlichte Quelle') }}</h4>
      <p class="source-overview__status" :class="{ 'source-overview__status--outdated': status === 'outdated' }" role="status" aria-live="polite">{{ statusLabel }}</p>
      <template v-if="published">
        <p class="source-overview__receipt"><span>{{ isCurrentRequest ? text('Current request', 'Aktuelle Anfrage') : text('Last request; no current publication', 'Letzte Anfrage; keine aktuelle Veröffentlichung') }}</span><code>{{ published.id }}</code><time :datetime="published.created_at">{{ date(published.created_at) }}</time></p>
        <details><summary>{{ text('Frozen published sources', 'Gespeicherte veröffentlichte Quellen') }}</summary>
          <p v-if="publishedLocal?.source">CV: {{ publishedLocal.source.cv.name }} · {{ text('source revision', 'Quellrevision') }} {{ publishedLocal.source.cv.baseRevision }}<br />{{ text('Letter source saved', 'Briefquelle gespeichert') }} {{ date(publishedLocal.source.letter.updatedAt) }}</p>
          <p v-else>{{ text('Original local document versions are unavailable. The published content below remains unchanged.', 'Ursprüngliche lokale Dokumentversionen sind nicht verfügbar. Der veröffentlichte Inhalt unten bleibt unverändert.') }}</p>
          <p>{{ published.request_json.letter.template.name }} · {{ text('revision', 'Revision') }} {{ published.request_json.letter.template.revision }} · {{ language(published.request_json.letter.language) }} · {{ published.request_json.letter.maxWords }} {{ text('words', 'Wörter') }}</p>
          <details><summary>{{ text('Published CV wording', 'Veröffentlichter CV-Wortlaut') }}</summary><article v-for="field in published.request_json.cv.fields" :key="field.id"><strong>{{ field.label }}</strong><pre>{{ field.text }}</pre></article></details>
          <details><summary>{{ text('Published letter source', 'Veröffentlichte Briefquelle') }}</summary><pre>{{ published.request_json.letter.text || text('No letter was supplied; an initial draft was requested.', 'Kein Brief übermittelt; ein erster Entwurf wurde angefordert.') }}</pre></details>
        </details>
      </template>
    </div>
  </section>
</template>

<style scoped>
.source-overview{border:1px solid #28534e;border-radius:10px;padding:16px;margin-bottom:16px;background:#091923;font-size:13px;line-height:1.5}
h3{font-size:16px;margin:0 0 12px}h4{font-size:13px;margin:0}.source-overview__values{display:grid;grid-template-columns:minmax(90px,31%) minmax(0,1fr);gap:9px 14px;margin:0 0 12px}dt{color:#9ebdb2}dd{margin:0;overflow-wrap:anywhere}small{display:block;color:#9ebdb2;font-size:11px}summary{cursor:pointer;font-size:12px}details{margin-top:10px}details[open]>summary{margin-bottom:8px}p{margin:8px 0}pre{max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}article{margin:10px 0}.source-overview__publication{border-top:1px solid #28534e;margin-top:14px;padding-top:12px}.source-overview__status{color:#b9edd9}.source-overview__status--outdated,.source-overview__empty{color:#efcc87}.source-overview__receipt{display:grid;gap:2px;font-size:12px}code{overflow-wrap:anywhere;color:#9ebdb2;font-size:11px}.source-overview__error{color:#fecaca}
@media(max-width:760px){.source-overview{padding:12px;font-size:14px}.source-overview__values{gap:10px}small,summary,.source-overview__receipt{font-size:12px}}
</style>
