<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { FIELD_PRIVACY_TYPES, type CvState, type FieldPrivacyType } from '../types';
import { makeT } from '../i18n/dict';
import FormBuilder from './FormBuilder.vue';
import { applyPrivacyEditorChanges, createPrivacyEditorState, privacyFieldEntries } from '../composables/privacyOverrides';
import { automaticMaskForField } from '../composables/privacyEditorMasking';
import { PRIVACY_EDITOR } from '../composables/privacyEditorContext';

const props = defineProps<{ state: CvState; lang: string }>();
const t = makeT(computed(() => props.lang));
const draft = ref(createPrivacyEditorState(props.state));
let refreshing = false;
let saving = false;
watch(() => props.state, () => {
  if (saving) return;
  refreshing = true;
  try { draft.value = createPrivacyEditorState(props.state); }
  finally { refreshing = false; }
}, { deep: true, flush: 'sync' });
watch(draft, value => {
  if (refreshing) return;
  saving = true;
  try { applyPrivacyEditorChanges(props.state, value); }
  finally { saving = false; }
}, { deep: true, flush: 'sync' });

const originals = computed(() => new Map(privacyFieldEntries(props.state).map(entry => [entry.key, entry])));
const draftFields = computed(() => {
  const owners = new WeakMap<object, Map<string, string>>();
  for (const entry of privacyFieldEntries(draft.value)) {
    if (!owners.has(entry.owner)) owners.set(entry.owner, new Map());
    owners.get(entry.owner)!.set(entry.field, entry.key);
  }
  return owners;
});
provide(PRIVACY_EDITOR, {
  language: () => props.lang,
  field(owner, field) {
    const key = draftFields.value.get(owner)?.get(field);
    const original = key && originals.value.get(key);
    if (!original) return;
    return {
      original: original.value,
      automaticMask: automaticMaskForField(props.state, original),
      changed: (Reflect.get(owner, field) ?? '') !== original.value,
      reset() {
        if (Object.hasOwn(original.owner, field)) Reflect.set(owner, field, Reflect.get(original.owner, field));
        else Reflect.deleteProperty(owner, field);
      },
    };
  },
  hiddenInContent(id) {
    return props.state.disabled.includes(id) || privacyFieldEntries(props.state)
      .some(entry => Reflect.get(entry.owner, 'id') === id && Reflect.get(entry.owner, 'hidden'));
  },
});

const proxyFields = ['institution', 'place', 'dates'] as const;
const proxyFieldLabels = { institution: 'institution', place: 'place', dates: 'privacyDates' };
const maskKeys = (field: FieldPrivacyType): FieldPrivacyType[] =>
  field === 'institution' || field === 'company' ? ['company', 'institution'] : [field];
const isFieldProxyChecked = (field: FieldPrivacyType) =>
  maskKeys(field).every(key => props.state.anonymization.proxyFields?.includes(key));
const isFieldProxyMixed = (field: FieldPrivacyType) => !isFieldProxyChecked(field)
  && maskKeys(field).some(key => props.state.anonymization.proxyFields?.includes(key));
function setFieldProxy(field: FieldPrivacyType, enabled: boolean) {
  const fields = new Set(props.state.anonymization.proxyFields || []);
  for (const key of maskKeys(field)) {
    if (enabled) fields.add(key);
    else fields.delete(key);
  }
  props.state.anonymization = { ...props.state.anonymization, proxyFields: FIELD_PRIVACY_TYPES.filter(key => fields.has(key)) };
}
const hasEdits = computed(() => Object.keys(props.state.anonymization.fieldOverrides || {}).length > 0);
function resetEdits() {
  const { fieldOverrides: _overrides, ...settings } = props.state.anonymization;
  props.state.anonymization = settings;
}
</script>

<template>
  <FormBuilder class="anonymization-panel" :state="draft" privacy-mode :toolbar-visible="false" :read-version="() => null" :save-version="() => false">
    <template #before-tabs>
      <div class="privacy-editor-intro">
        <fieldset class="privacy-automatic">
          <legend>{{ t('privacyAutomaticMasking') }}</legend>
          <div class="privacy-automatic__fields">
            <label class="privacy-automatic__header" :title="t('privacyHeaderMaskedHelp')">
              <input type="checkbox" checked disabled :aria-label="t('header')">
              <span>{{ t('header') }}</span>
            </label>
            <label v-for="field in proxyFields" :key="field">
              <input type="checkbox" :checked="isFieldProxyChecked(field)" :indeterminate="isFieldProxyMixed(field)" @change="setFieldProxy(field, ($event.target as HTMLInputElement).checked)">
              <span>{{ t(proxyFieldLabels[field]) }}</span>
            </label>
          </div>
          <p class="privacy-editor-help">{{ t('privacyEditorHelp') }}</p>
        </fieldset>
        <button v-if="hasEdits" class="privacy-reset" type="button" @click="resetEdits">{{ t('privacyResetAll') }}</button>
      </div>
    </template>
  </FormBuilder>
</template>

<style scoped>
.privacy-editor-intro { flex: none; display: grid; gap: 4px; padding-bottom: 12px; }
.privacy-automatic { min-width: 0; margin: 0; padding: 0; border: 0; }
.privacy-automatic legend { padding: 0 0 4px; color: var(--ui-text); font-size: 13px; font-weight: 600; }
.privacy-automatic__fields { display: flex; flex-wrap: wrap; gap: 0 16px; }
.privacy-automatic__fields label { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; color: var(--ui-text); cursor: pointer; white-space: nowrap; }
.privacy-automatic__fields input { flex-shrink: 0; width: 16px; height: 16px; margin: 0; accent-color: var(--ui-accent); }
.privacy-automatic__fields .privacy-automatic__header { cursor: help; }
.privacy-editor-help { margin: 0; padding: 4px 0 0; color: var(--ui-muted); font-size: 12px; line-height: 1.5; }
.privacy-reset { justify-self: start; padding: 4px 0; border: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 12px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.privacy-reset:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
</style>
