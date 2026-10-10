<script setup lang="ts">
defineProps<{
  title?: string;
  collapsed: boolean;
  controls: string;
  editing?: boolean;
  editLabel?: string;
  disabled?: boolean;
}>();
defineEmits<{ activate: []; 'toggle-collapse': [] }>();
</script>

<template>
  <h3 class="section-name-label" :class="{ 'section-name-label--static': !editing }">
    <button v-if="editing && !disabled" class="section-collapse-button" type="button" :aria-expanded="!collapsed" :aria-controls="controls" :aria-label="title" @click.stop="$emit('toggle-collapse')">
      <font-awesome-icon :icon="['fas', 'chevron-right']" :class="{ 'is-expanded': !collapsed }" aria-hidden="true" />
    </button>
    <span v-if="disabled">{{ title }}</span>
    <button
      v-else
      :id="`${controls}-heading`"
      class="section-heading-button"
      type="button"
      :aria-expanded="editing ? undefined : !collapsed"
      :aria-controls="editing ? undefined : controls"
      :aria-label="editing ? `${editLabel}: ${title}` : undefined"
      @click.stop="$emit('activate')"
    >{{ title }}</button>
  </h3>
</template>

<style scoped>
.section-name-label { display: flex; align-items: center; gap: 6px; min-width: 0; overflow-wrap: anywhere; }
.section-heading-button { display: block; width: 100%; min-width: 0; padding: 0; border: 0; border-radius: 2px; background: transparent; color: inherit; font: inherit; text-align: start; overflow-wrap: anywhere; cursor: pointer; }
.section-collapse-button { display: grid; place-items: center; flex: 0 0 24px; width: 24px; min-height: 28px; padding: 0; border: 0; background: transparent; color: var(--ui-muted); cursor: pointer; }
.section-collapse-button .is-expanded { transform: rotate(90deg); }
.section-heading-button:focus-visible, .section-collapse-button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
@media (max-width: 760px) { .section-heading-button { min-height: 32px; } }
</style>
