<script setup lang="ts">
import { computed, inject, useId } from 'vue';
import { normalizeMarkdownText } from '../composables/markdownText.ts';
import { CV_TEXTAREA_COMMIT } from '../composables/cvTextareaCommit';
import AutosaveTextarea from './AutosaveTextarea.vue';

defineOptions({ inheritAttrs: false });

const props = defineProps({
  modelValue: { type: String, default: '' },
  placeholder: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  help: { type: String, default: '' },
  rows: { type: Number, default: 3 },
});
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const helpId = `markdown-help-${useId()}`;
const commit = inject(CV_TEXTAREA_COMMIT, () => {});

const value = computed({
  get: () => normalizeMarkdownText(props.modelValue),
  set: (nextValue) => emit('update:modelValue', nextValue),
});

const emptyPlaceholder = computed(() => [props.placeholder, props.help].filter(Boolean).join('\n'));
</script>

<template>
  <AutosaveTextarea v-bind="$attrs" v-model.lazy="value" class="p-textarea p-component p-textarea-fluid" :placeholder="emptyPlaceholder" :aria-label="ariaLabel || undefined" :aria-describedby="help ? helpId : undefined" auto-resize :rows="rows" @commit="commit" />
  <span v-if="help" :id="helpId" class="markdown-help">{{ help }}</span>
</template>

<style scoped>
.markdown-help { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
</style>
