<script setup lang="ts">
import { computed } from 'vue';
import type { Application } from '../cloudTypes';
import type { ApplicationLetter } from '../letterTypes';
import type { ApplicationCvRecord } from '../composables/applicationCv';
import type { LocalRefinementRequest, PrivacyContextType } from '../refinementTypes';
import type { ResolvedRefinementSettings } from '../composables/refinementSources';
import RefinementPrivacyPreview from './RefinementPrivacyPreview.vue';
import { serializeRefinementDraft } from '../composables/refinementSources';

const props = defineProps<{
  application: Application; record: ApplicationCvRecord | null; letter: ApplicationLetter | null; lang: string;
  settings: ResolvedRefinementSettings; prepared: LocalRefinementRequest | null; sourceError: string;
}>();
const emit = defineEmits<{ approveContext: [sourceKey: string, type: PrivacyContextType, description: string]; removeContext: [sourceKey: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const draft = computed(() => serializeRefinementDraft(props.letter?.working));
const sourceWords = computed(() => (props.prepared?.request.letter.text ?? draft.value.text).trim().split(/\s+/).filter(Boolean).length);
const hasTemplate = computed(() => !!props.letter?.templateSnapshot);
const language = (value: string) => ({ en: 'English', de: 'Deutsch' })[value] || value;
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(props.lang === 'de' ? 'de-DE' : 'en-GB') : text('Not recorded', 'Nicht erfasst');
const origin = (value: string) => value === 'application' ? text('Saved application setting', 'Gespeicherte Bewerbungseinstellung') : text('Frozen template default', 'Standard der gespeicherten Vorlage');
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
      <RefinementPrivacyPreview v-if="prepared" :request="prepared.request" :local-cv="prepared.cv" :lang="lang" @approve="(key, type, description) => emit('approveContext', key, type, description)" @remove="key => emit('removeContext', key)" />
    </details>
    <p v-if="sourceError" class="source-overview__error" role="alert">{{ sourceError }}</p>
  </section>
</template>

<style scoped>
.source-overview{border:1px solid #28534e;border-radius:10px;padding:16px;margin-bottom:16px;background:#091923;font-size:13px;line-height:1.5}
h3{font-size:16px;margin:0 0 12px}.source-overview__values{display:grid;grid-template-columns:minmax(90px,31%) minmax(0,1fr);gap:9px 14px;margin:0 0 12px}dt{color:#9ebdb2}dd{margin:0;overflow-wrap:anywhere}small{display:block;color:#9ebdb2;font-size:11px}summary{cursor:pointer;font-size:12px}details{margin-top:10px}details[open]>summary{margin-bottom:8px}p{margin:8px 0}.source-overview__empty{color:#efcc87}.source-overview__error{color:#fecaca}
@media(max-width:760px){.source-overview{padding:12px;font-size:14px}.source-overview__values{gap:10px}small,summary{font-size:12px}}
</style>
