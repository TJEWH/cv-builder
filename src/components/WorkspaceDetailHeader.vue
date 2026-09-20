<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; backLabel: string; status?: string }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <header class="workspace-detail-header">
    <div class="workspace-detail-header__main">
      <button class="btn workspace-detail-header__back" type="button" @click="emit('back')"><span aria-hidden="true">←</span> {{ backLabel }}</button>
      <div class="workspace-detail-header__title"><h1>{{ title }}</h1><p v-if="subtitle">{{ subtitle }}</p></div>
      <span v-if="status" class="workspace-detail-header__status">{{ status }}</span>
    </div>
    <div v-if="$slots.metadata" class="workspace-detail-header__metadata"><slot name="metadata" /></div>
  </header>
</template>

<style scoped>
.workspace-detail-header { flex: 0 0 auto; min-width: 0; padding-bottom: 14px; border-bottom: 1px solid #24504e; color: #d1fae5; background: #06141f; }
.workspace-detail-header__main { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; min-width: 0; }
.workspace-detail-header__back { flex-shrink: 0; }
.workspace-detail-header__title { flex: 1 1 240px; min-width: 0; }
.workspace-detail-header__title h1 { margin: 0; font-size: 24px; line-height: 1.25; overflow-wrap: anywhere; }
.workspace-detail-header__title p { margin: 5px 0 0; color: #a6c1b9; font-size: 13px; overflow-wrap: anywhere; }
.workspace-detail-header__status { padding: 5px 9px; border: 1px solid #356454; border-radius: 6px; color: #b9edd9; font-size: 12px; }
.workspace-detail-header__metadata { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 14px; color: #a6c1b9; font-size: 12px; }
@media (min-width: 761px) and (max-height: 600px) {
  .workspace-detail-header { padding-bottom: 8px; }
  .workspace-detail-header__title h1 { font-size: 18px; }
  .workspace-detail-header__metadata { margin-top: 6px; }
}
@media (max-width: 760px) {
  .workspace-detail-header { padding-bottom: 10px; border: 0; background: transparent; }
  .workspace-detail-header__main { gap: 6px 10px; }
  .workspace-detail-header__back { min-height: 40px; padding: 4px 0; border: 0; border-radius: 0; background: transparent; }
  .workspace-detail-header__title { flex-basis: 100%; order: 2; }
  .workspace-detail-header__title h1 { font-size: 19px; }
  .workspace-detail-header__status { margin-left: auto; padding: 0; border: 0; }
  .workspace-detail-header__metadata { gap: 8px 12px; margin-top: 8px; }
}
</style>
