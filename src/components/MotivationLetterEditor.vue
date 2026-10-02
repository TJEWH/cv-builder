<script setup lang="ts">
// Compatibility entry point: all preparation, proposals and persistence live in ApplicationWorkspace.
defineProps<{ lang: string; disabled?: boolean }>();
const emit = defineEmits<{ refine: [scope: 'letter'] }>();
</script>
<template><button type="button" :disabled="disabled" @click="emit('refine', 'letter')">{{ lang === 'de' ? 'Brief entwerfen oder überarbeiten' : 'Draft or refine letter' }}</button></template>
