<script setup>
import { computed } from 'vue';
import { normalizeMarkdownText } from '../composables/markdownText.js';

const props = defineProps({
  modelValue: { type: [String, Array], default: '' },
  placeholder: { type: String, default: '' },
  ariaLabel: { type: String, default: '' },
  help: { type: String, default: '' },
  rows: { type: Number, default: 3 },
});
const emit = defineEmits(['update:modelValue']);

const value = computed({
  get: () => normalizeMarkdownText(props.modelValue),
  set: (nextValue) => emit('update:modelValue', nextValue),
});

const emptyPlaceholder = computed(() => [props.placeholder, props.help].filter(Boolean).join('\n'));
</script>

<template>
  <Textarea v-model="value" :placeholder="emptyPlaceholder" :aria-label="ariaLabel" auto-resize fluid :rows="rows" />
</template>
