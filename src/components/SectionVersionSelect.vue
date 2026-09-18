<script setup>
defineProps({
  modelValue: String,
  options: { type: Array, default: () => [] },
  label: String,
  draftLabel: String,
});
defineEmits(['update:modelValue']);
</script>

<template>
  <select class="section-version-select" :value="modelValue" :aria-label="label" @click.stop @change="$emit('update:modelValue', $event.target.value)">
    <option v-for="option in options" :key="option.id" :value="option.id">{{ option.name || draftLabel }}</option>
  </select>
</template>

<style scoped>
.section-version-select { width: min(200px, 45%); min-width: 100px; margin-left: auto; }
</style>
