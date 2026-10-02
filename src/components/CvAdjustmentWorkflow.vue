<script setup lang="ts">
// Compatibility entry point: all preparation, proposals and persistence live in ApplicationWorkspace.
defineProps<{ lang: string; disabled?: boolean }>();
const emit = defineEmits<{ refine: [scope: 'cv'] }>();
</script>
<template><button type="button" :disabled="disabled" @click="emit('refine', 'cv')">{{ lang === 'de' ? 'CV anpassen' : 'Tailor CV' }}</button></template>
