<script setup lang="ts">
defineProps<{ modelValue: 'original' | 'proposed'; label: string; reference: string; outdated: boolean; lang: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: 'original' | 'proposed'] }>();
</script>

<template>
  <div class="refinement-preview-status">
    <p class="app-hint" role="status">{{ label }}<br /><small>{{ reference }}</small></p>
    <p v-if="outdated" class="app-hint refinement-preview-status__outdated">{{ lang === 'de' ? 'Veraltet — Übernahme gesperrt. Vorschau aus dem exakten gespeicherten Snapshot.' : 'Outdated — acceptance blocked. Preview uses the exact saved snapshot.' }}</p>
    <div class="refinement-preview-status__comparison" :aria-label="lang === 'de' ? 'Vorschlag vergleichen' : 'Compare proposal'">
      <button type="button" :aria-pressed="modelValue === 'original'" @click="emit('update:modelValue', 'original')">Original</button>
      <button type="button" :aria-pressed="modelValue === 'proposed'" @click="emit('update:modelValue', 'proposed')">{{ lang === 'de' ? 'Vorschlag' : 'Proposed' }}</button>
    </div>
  </div>
</template>

<style scoped>
.refinement-preview-status{display:grid;gap:7px;width:100%;color:#efcc87;font:12px/1.5 var(--font-ui,system-ui);box-sizing:border-box}
.refinement-preview-status p{margin:0;overflow-wrap:anywhere}
.refinement-preview-status small{color:#b1c6bd;font-size:10px}
.refinement-preview-status__outdated{color:#fecaca}
.refinement-preview-status__comparison{display:flex;gap:6px}
.refinement-preview-status button{border:1px solid #28534e;border-radius:6px;padding:5px 9px;background:#0b1b25;color:#d1fae5;font:inherit;cursor:pointer}
.refinement-preview-status button[aria-pressed=true]{border-color:#67c8a6;background:#185b4c}
</style>
