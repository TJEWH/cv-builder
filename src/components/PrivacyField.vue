<script setup lang="ts">
import { computed, inject, useId } from 'vue';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { faRotateLeft } from '@fortawesome/free-solid-svg-icons';
import { PRIVACY_EDITOR } from '../composables/privacyEditorContext';
import { makeT } from '../i18n/dict';

const props = defineProps<{ owner: object; field: string }>();
const context = inject(PRIVACY_EDITOR, null);
const status = computed(() => context?.field(props.owner, props.field));
const disabled = computed(() => Boolean(status.value?.automaticMask));
const t = makeT(computed(() => context?.language() || 'en'));
const helpId = `privacy-mask-help-${useId()}`;
const help = computed(() => {
  if (!disabled.value) return '';
  const explanation = t(status.value?.automaticMask === 'header' ? 'privacyHeaderMaskedHelp' : 'privacyFieldMaskedHelp');
  return status.value?.changed ? `${explanation} ${t('privacySavedEditHelp')}` : explanation;
});
</script>

<template>
  <div class="editor-field" :class="{ 'privacy-field--edited': status?.changed, 'privacy-field--masked': disabled }"
    :title="help || undefined" :tabindex="disabled ? 0 : undefined" :role="disabled ? 'group' : undefined" :aria-describedby="disabled ? helpId : undefined">
    <slot :disabled="disabled" />
    <span v-if="disabled" :id="helpId" class="privacy-field-help">{{ help }}</span>
    <button v-if="status?.changed" class="privacy-field-revert" type="button" :aria-label="t('privacyRevertField')" :title="t('privacyRevertField')" @click.stop.prevent="status.reset()">
      <FontAwesomeIcon :icon="faRotateLeft" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.editor-field { position: relative; min-width: 0; }
.privacy-field--edited :deep(label) { display: block; }
.privacy-field--edited :deep(.p-inputtext), .privacy-field--edited :deep(.p-select), .privacy-field--edited :deep(textarea) { border-color: var(--ui-accent-border); background: var(--ui-active); }
.privacy-field--masked { cursor: help; }
.privacy-field--masked :deep(input:disabled), .privacy-field--masked :deep(textarea:disabled), .privacy-field--masked :deep(.p-disabled) { background: var(--ui-surface); color: var(--ui-muted); border-color: var(--ui-divider); opacity: .65; cursor: not-allowed; pointer-events: none; }
.privacy-field--masked:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; border-radius: 4px; }
.privacy-field-revert { position: absolute; top: -5px; right: 0; display: grid; place-items: center; width: 28px; height: 24px; padding: 0; border: 0; border-radius: 4px; color: var(--ui-accent); background: var(--ui-surface); cursor: pointer; }
.privacy-field-revert:hover { background: var(--ui-surface-hover); }
.privacy-field-revert:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.privacy-field-help { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
