<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { LocalCvAdjustmentRequest } from '../cvAdjustmentTypes';
import type { PrivacyContextType, RefinementRequest } from '../refinementTypes';
import { privacyContextTargets, PRIVACY_CONTEXT_TYPES, PRIVACY_DESCRIPTION_LIMIT } from '../composables/refinementPrivacy';
import { refinementSignature } from '../composables/applicationRefinement';
import PrivacyTextPreview from './PrivacyTextPreview.vue';

const props = defineProps<{ request: RefinementRequest; localCv?: LocalCvAdjustmentRequest; lang: string }>();
const emit = defineEmits<{ approve: [sourceKey: string, type: PrivacyContextType, description: string]; remove: [sourceKey: string] }>();
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const targets = computed(() => props.localCv ? privacyContextTargets(props.localCv, refinementSignature) : []);
const templateStyle = computed(() => {
  const { researchInterests: _interests, questionGuidance: _questions, ...style } = props.request.letter.template;
  return style;
});
const drafts = reactive<Record<string, { type: PrivacyContextType; description: string }>>({});
function draft(target: typeof targets.value[number]) {
  if (!drafts[target.sourceKey]) {
    const approved = props.request.privacyLegend?.find(entry => entry.token === target.token && entry.fieldId === target.fieldId);
    drafts[target.sourceKey] = { type: approved?.type || 'other', description: approved?.description || '' };
  }
  return drafts[target.sourceKey]!;
}
function approved(token: string) { return props.request.privacyLegend?.find(entry => entry.token === token); }
const typeLabel = (type: PrivacyContextType) => ({ person: text('Person', 'Person'), organization: text('Organization', 'Organisation'), location: text('Location', 'Ort'), link: text('Link', 'Link'), contact: text('Contact', 'Kontakt'), confidential: text('Confidential text', 'Vertraulicher Text'), other: text('Other', 'Sonstiges') })[type];
</script>

<template>
  <section class="privacy-review" :aria-label="text('Privacy preview', 'Datenschutzvorschau')">
    <h4>{{ text('Privacy preview', 'Datenschutzvorschau') }}</h4>
    <dl class="privacy-statuses">
      <dt>{{ text('Visible', 'Sichtbar') }}</dt><dd>{{ text('Ordinary text is shared as shown, including unmasked employers, locations and links.', 'Normaler Text wird wie angezeigt geteilt, einschließlich unmaskierter Arbeitgeber, Orte und Links.') }}</dd>
      <dt class="pseudonymized">{{ text('Pseudonymized', 'Pseudonymisiert') }}</dt><dd>{{ text('Highlighted placeholders replace protected values. Replacing contact details does not make the document fully anonymous.', 'Hervorgehobene Platzhalter ersetzen geschützte Werte. Ersetzte Kontaktdaten machen das Dokument nicht vollständig anonym.') }}</dd>
      <dt>{{ text('Not shared', 'Nicht geteilt') }}</dt><dd>{{ text('Private originals, local reconstruction mappings, and hidden or privacy-excluded CV content stay on this device.', 'Private Originale, lokale Wiederherstellungszuordnungen sowie ausgeblendete oder ausgeschlossene CV-Inhalte bleiben auf diesem Gerät.') }}</dd>
    </dl>
    <details class="disclosure-row"><summary>{{ text('CV wording to share', 'Zu teilender CV-Wortlaut') }}</summary><article v-for="field in request.cv.fields" :key="field.id"><strong>{{ field.label }}</strong><PrivacyTextPreview :value="field.text" :lang="lang" /></article></details>
    <details class="disclosure-row"><summary>{{ text('Complete letter to share', 'Vollständiger zu teilender Brief') }}</summary><PrivacyTextPreview :value="request.letter.text || text('Empty — request an initial draft.', 'Leer — ersten Entwurf anfordern.')" :lang="lang" /></details>
    <details class="disclosure-row"><summary>{{ text('Opportunity context & additional instructions', 'Ausschreibungskontext & zusätzliche Hinweise') }}</summary><PrivacyTextPreview :value="JSON.stringify(request.cv.opportunity, null, 2)" :lang="lang" /><PrivacyTextPreview :value="request.cv.instructions || '—'" :lang="lang" /></details>
    <details class="disclosure-row"><summary>{{ text('Template guidance & example text', 'Vorlagenhinweise & Beispieltext') }}</summary>
      <h5>{{ text('Research interests', 'Forschungsinteressen') }}</h5><PrivacyTextPreview :value="request.letter.template.researchInterests || text('Not specified', 'Nicht angegeben')" :lang="lang" />
      <h5>{{ text('Follow-up question guidance', 'Hinweise für Rückfragen') }}</h5><PrivacyTextPreview :value="request.letter.template.questionGuidance || text('Not specified', 'Nicht angegeben')" :lang="lang" />
      <PrivacyTextPreview :value="JSON.stringify(templateStyle, null, 2)" :lang="lang" />
    </details>
    <details class="disclosure-row"><summary>{{ text('Outgoing saved feedback', 'Ausgehendes gespeichertes Feedback') }} ({{ request.feedback.length }})</summary><article v-for="item in request.feedback" :key="item.id"><strong>{{ item.scope }} · {{ item.createdAt }}</strong><PrivacyTextPreview :value="item.text" :lang="lang" /></article></details>
    <details v-if="targets.length || request.privacyLegend?.length" class="disclosure-row privacy-contexts">
      <summary>{{ text('Approved context descriptions (optional)', 'Freigegebene Kontextbeschreibungen (optional)') }}</summary>
      <p>{{ text('Enter general context yourself, then approve it for sharing. No description is generated from private data. Tokens remain the reference; descriptions never replace originals or mappings.', 'Allgemeinen Kontext selbst eingeben und zum Teilen freigeben. Beschreibungen werden nicht aus privaten Daten erzeugt. Tokens bleiben die Referenz; Beschreibungen ersetzen weder Originale noch Zuordnungen.') }}</p>
      <article v-for="target in targets" :key="target.sourceKey" class="privacy-context">
        <strong>{{ target.label }}</strong> · <code>{{ target.token }}</code>
        <label>{{ text('Type', 'Typ') }}<select v-model="draft(target).type"><option v-for="type in PRIVACY_CONTEXT_TYPES" :key="type" :value="type">{{ typeLabel(type) }}</option></select></label>
        <label>{{ text('Approved context description', 'Freigegebene Kontextbeschreibung') }}<textarea v-model="draft(target).description" rows="2" :maxlength="PRIVACY_DESCRIPTION_LIMIT" :placeholder="text('e.g. Engineering company specializing in sensor technology', 'z. B. Ingenieurunternehmen mit Schwerpunkt Sensortechnik')" /></label>
        <p class="context-status">{{ approved(target.token) ? text('Included after approval:', 'Nach Freigabe enthalten:') : text('No description shared.', 'Keine Beschreibung geteilt.') }} {{ approved(target.token)?.description }}</p>
        <button type="button" :disabled="!draft(target).description.trim()" @click="emit('approve', target.sourceKey, draft(target).type, draft(target).description)">{{ text('Approve & include', 'Freigeben & aufnehmen') }}</button>
        <button v-if="approved(target.token)" type="button" @click="emit('remove', target.sourceKey)">{{ text('Remove description', 'Beschreibung entfernen') }}</button>
      </article>
      <article v-for="entry in localCv ? [] : request.privacyLegend" :key="entry.token"><strong>{{ entry.fieldId }}</strong> · <code>{{ entry.token }}</code><p>{{ typeLabel(entry.type) }} · {{ entry.description }}</p></article>
    </details>
  </section>
</template>

<style scoped>
.privacy-review{margin-top:12px;font-size:13px;line-height:1.5}h4{margin:0 0 8px}.privacy-statuses{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 14px}dt{font-weight:600}dd{margin:0;color:#b4ccc3}.pseudonymized,code{color:#e5f5ac}article{margin:12px 0}.privacy-context{border:1px solid #34534d;border-radius:8px;padding:12px}label{display:grid;gap:5px;margin-top:10px}select,textarea{box-sizing:border-box;width:100%;padding:8px;color:inherit;background:#0c1f27;border:1px solid #3c5f56;border-radius:5px;font:inherit}textarea{resize:vertical}button{margin:5px 8px 0 0;border:1px solid #447565;border-radius:5px;background:#173c30;color:#d9e8e3;padding:7px 10px;cursor:pointer}button:disabled{opacity:.5;cursor:default}.context-status{color:#b4ccc3;font-size:12px;overflow-wrap:anywhere}
@media(max-width:600px){.privacy-statuses{grid-template-columns:1fr;gap:3px}.privacy-statuses dd{margin-bottom:9px}}
</style>
