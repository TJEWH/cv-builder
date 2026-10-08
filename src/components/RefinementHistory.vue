<script setup lang="ts">
import { computed } from 'vue';
import type { LocalRefinementRequest, RefinementProposalRow, RefinementRequestRow } from '../refinementTypes';
import { refinementRunMetadata, visibleRefinementProposals } from '../composables/refinementHistory';
import RefinementPrivacyPreview from './RefinementPrivacyPreview.vue';
const props = defineProps<{
  requests: RefinementRequestRow[]; proposals: RefinementProposalRow[]; localRequests: Record<string, LocalRefinementRequest>;
  currentRequestId: string | null; activeId: string; reviewActive: boolean; accepted: boolean;
  publicationStatus: 'unpublished' | 'current' | 'outdated' | 'unverifiable'; lang: string; busy: boolean; open: boolean;
}>();
const emit = defineEmits<{ select: [id: string]; details: [open: boolean]; exportRequest: [id: string]; exportProposal: [id: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const unknown = () => text('Unknown', 'Unbekannt');
const date = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(props.lang === 'de' ? 'de-DE' : 'en-GB') : unknown();
const current = computed(() => props.requests.find(row => row.id === props.currentRequestId));
const available = computed(() => visibleRefinementProposals(props.proposals, props.currentRequestId, props.activeId));
const state = computed(() => !current.value ? props.currentRequestId ? text('Request unavailable', 'Anfrage nicht verfügbar') : text('Not published', 'Nicht veröffentlicht')
  : props.publicationStatus === 'outdated' ? text('Sources changed — publish a new round', 'Quellen geändert — neue Runde veröffentlichen')
  : props.publicationStatus === 'unverifiable' ? text('Local sources unavailable', 'Lokale Quellen nicht verfügbar')
  : props.proposals.some(row => row.request_id === current.value!.id) ? text('Proposals available', 'Vorschläge verfügbar') : text('Published — waiting for a proposal', 'Veröffentlicht — Vorschlag ausstehend'));
const runs = computed(() => props.requests.map(row => ({ row, metadata: refinementRunMetadata(row, props.localRequests[row.id]), proposals: props.proposals.filter(proposal => proposal.request_id === row.id) })));
</script>

<template>
  <section class="refinement-history" :aria-label="text('Refinement runs', 'Überarbeitungsrunden')">
    <div class="current-run">
      <p class="app-hint" role="status"><strong>{{ text('Current request', 'Aktuelle Anfrage') }}:</strong> {{ state }}</p>
      <label v-if="available.length">{{ text('Available proposals', 'Verfügbare Vorschläge') }}<select :value="activeId" :disabled="busy" @change="emit('select', ($event.target as HTMLSelectElement).value)"><option value="" disabled>{{ text('Select a proposal', 'Vorschlag auswählen') }}</option><option v-for="proposal in available" :key="proposal.id" :value="proposal.id">{{ date(proposal.created_at) }} · {{ proposal.id }}{{ proposal.request_id !== currentRequestId ? text(' · Older run', ' · Frühere Runde') : '' }}</option></select></label>
      <p v-if="activeId" class="app-hint">{{ reviewActive ? accepted ? text('Accepted selection', 'Angenommene Auswahl') : text('Active proposal — not yet accepted', 'Aktiver Vorschlag — noch nicht angenommen') : text('Preview closed — showing working documents', 'Vorschau geschlossen — Arbeitsfassungen werden angezeigt') }}</p>
    </div>
    <details class="disclosure-row run-details" :open="open" @toggle="emit('details', ($event.target as HTMLDetailsElement).open)">
      <summary>{{ text('History / Details', 'Verlauf / Details') }}</summary>
      <p class="app-hint">{{ text('Historical metadata comes from saved records. Missing versions remain unknown.', 'Historische Metadaten stammen aus gespeicherten Datensätzen. Fehlende Versionen bleiben unbekannt.') }}</p>
      <details v-for="run in runs" :key="run.row.id" class="disclosure-row history-run">
        <summary>{{ date(run.row.created_at) }} · {{ run.row.request_json.scope }} · {{ run.proposals.length }} {{ text('proposals', 'Vorschläge') }}{{ run.row.id === currentRequestId ? text(' · Current', ' · Aktuell') : '' }}</summary>
        <dl>
          <dt>{{ text('Request', 'Anfrage') }}</dt><dd><code>{{ run.metadata.requestId }}</code></dd>
          <dt>{{ text('Created', 'Erstellt') }}</dt><dd>{{ date(run.metadata.createdAt) }}</dd>
          <dt>{{ text('CV source revision', 'CV-Quellrevision') }}</dt><dd>{{ run.metadata.cvRevision ?? unknown() }}</dd>
          <dt>{{ text('Exact CV version', 'Exakte CV-Version') }}</dt><dd><code>{{ run.metadata.cvVersion ?? unknown() }}</code></dd>
          <dt>{{ text('Letter source version', 'Brief-Quellversion') }}</dt><dd><code>{{ run.metadata.letterVersion ?? unknown() }}</code></dd>
          <dt>{{ text('Template', 'Vorlage') }}</dt><dd>{{ run.metadata.templateName }} · r{{ run.metadata.templateRevision }}</dd>
          <dt>{{ text('Prompt version', 'Prompt-Version') }}</dt><dd>{{ run.metadata.promptVersion ?? unknown() }}</dd>
          <dt>{{ text('Schema version', 'Schemaversion') }}</dt><dd>{{ run.metadata.protocolVersion }}</dd>
          <dt>{{ text('Approved additional instructions', 'Freigegebene zusätzliche Hinweise') }}</dt><dd class="pre-wrap">{{ run.metadata.instructions || text('None supplied', 'Keine übermittelt') }}</dd>
        </dl>
        <button type="button" @click="emit('exportRequest', run.row.id)">{{ text('Export public request', 'Öffentliche Anfrage exportieren') }}</button>
        <div v-for="proposal in run.proposals" :key="proposal.id" class="history-proposal"><p><code>{{ proposal.id }}</code> · {{ date(proposal.created_at) }}</p><p>{{ proposal.proposal_json.summary }}</p><button type="button" :disabled="busy" @click="emit('select', proposal.id)">{{ text('Review this proposal', 'Diesen Vorschlag prüfen') }}</button><button type="button" @click="emit('exportProposal', proposal.id)">{{ text('Export proposal', 'Vorschlag exportieren') }}</button></div>
        <details class="disclosure-row"><summary>{{ text('Captured public sources', 'Gespeicherte öffentliche Quellen') }}</summary><RefinementPrivacyPreview :request="run.row.request_json" :lang="lang" /></details>
      </details>
      <slot />
    </details>
  </section>
</template>

<style scoped>
.refinement-history{margin:16px 0 0;padding:0;font-size:13px;line-height:1.5}.current-run{padding:0 0 14px}h3{font-size:16px;margin:0 0 8px}p{margin:8px 0}code,dd{overflow-wrap:anywhere}code{font-size:11px;color:#a6c1b9}label{display:grid;gap:8px;margin-top:12px}select{width:100%;min-width:0}button,select{color:inherit;background:#0b1b25;border:1px solid #28534e;border-radius:6px;padding:8px;font:inherit}button{cursor:pointer;margin:5px 8px 5px 0}button:disabled{opacity:.5}dl{display:grid;grid-template-columns:minmax(90px,35%) minmax(0,1fr);gap:7px 12px}dt{color:#a6c1b9}dd{margin:0}.pre-wrap{white-space:pre-wrap}.history-proposal{border-left:2px solid #447565;margin:14px 0;padding-left:12px}
@media(max-width:600px){dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:9px}select{font-size:16px}}
</style>
