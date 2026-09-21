<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; backLabel: string; status?: string }>();
const emit = defineEmits<{ back: [] }>();
</script>

<template>
  <header class="workspace-detail-header">
    <div class="workspace-detail-header__main">
      <div class="workspace-detail-header__controls">
        <button class="btn workspace-detail-header__back" type="button" :aria-label="backLabel" @click="emit('back')"><span aria-hidden="true">←</span><span class="workspace-detail-header__back-label">{{ backLabel }}</span></button>
        <div v-if="$slots.actions" class="workspace-detail-header__actions"><slot name="actions" /></div>
      </div>
      <div class="workspace-detail-header__title"><h1>{{ title }}</h1><p v-if="subtitle">{{ subtitle }}</p></div>
      <span v-if="status" class="workspace-detail-header__status">{{ status }}</span>
    </div>
    <div v-if="$slots.metadata" class="workspace-detail-header__metadata"><slot name="metadata" /></div>
    <div v-if="$slots['secondary-actions']" class="workspace-detail-header__secondary-actions"><slot name="secondary-actions" /></div>
  </header>
</template>

<style scoped>
.workspace-detail-header { flex: 0 0 auto; min-width: 0; padding-bottom: 14px; border-bottom: 1px solid #24504e; color: #d1fae5; background: #06141f; }
.workspace-detail-header__main { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; min-width: 0; }
.workspace-detail-header__controls { display: contents; }
.workspace-detail-header__back { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; order: 0; }
.workspace-detail-header__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; margin-left: auto; order: 3; }
.workspace-detail-header__title { flex: 1 1 240px; min-width: 0; order: 1; }
.workspace-detail-header__title h1 { margin: 0; font-size: 24px; line-height: 1.25; overflow-wrap: anywhere; }
.workspace-detail-header__title p { margin: 5px 0 0; color: #a6c1b9; font-size: 13px; overflow-wrap: anywhere; }
.workspace-detail-header__status { order: 2; padding: 5px 9px; border: 1px solid #356454; border-radius: 6px; color: #b9edd9; font-size: 12px; }
.workspace-detail-header__metadata { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: 14px; color: #a6c1b9; font-size: 12px; }
.workspace-detail-header__secondary-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
@media (min-width: 761px) and (max-height: 600px) {
  .workspace-detail-header { padding-bottom: 8px; }
  .workspace-detail-header__title h1 { font-size: 18px; }
  .workspace-detail-header__metadata { margin-top: 6px; }
}
@media (max-width: 760px) {
  .workspace-detail-header { padding: 0 8px 8px; border-bottom: 1px solid #24504e; background: transparent; }
  .workspace-detail-header__main { gap: 4px 8px; }
  .workspace-detail-header__controls { position: fixed; inset-inline: 0; bottom: calc(var(--mobile-tabs-height, 76px) + var(--mobile-application-tabs-height, 0px)); z-index: 35; display: flex; align-items: center; gap: 8px; box-sizing: border-box; height: var(--mobile-context-row-height, 52px); padding: 5px 8px; border-top: 1px solid #24504e; background: #071c26; }
  .workspace-detail-header__back { justify-content: center; width: 40px; min-height: 40px; padding: 0; font-size: 22px; }
  .workspace-detail-header__back-label { display: none; }
  .workspace-detail-header__actions { flex: 1; flex-wrap: nowrap; justify-content: flex-end; gap: 6px; }
  .workspace-detail-header__actions :deep(> *) { min-width: 0; }
  .workspace-detail-header__actions :deep(button), .workspace-detail-header__actions :deep(select) { min-height: 40px; }
  .workspace-detail-header__title { flex-basis: 100%; }
  .workspace-detail-header__title h1 { font-size: 17px; line-height: 1.25; }
  .workspace-detail-header__title p { margin-top: 3px; font-size: 13px; line-height: 1.35; }
  .workspace-detail-header__status { display: none; }
  .workspace-detail-header__metadata { gap: 4px 10px; margin-top: 6px; font-size: 12px; line-height: 1.35; }
  .workspace-detail-header__secondary-actions { margin-top: 2px; }
}
</style>
