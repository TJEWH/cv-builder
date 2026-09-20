<script setup lang="ts">
import { ref, watch } from 'vue';
import type { CvState } from '../types';
import { cloneCv, listCareerRevisions, pinCareerRevision } from '../composables/applicationCv';
import type { CareerRevision } from '../composables/applicationCv';
const props = defineProps<{ variantId: string; state: CvState }>();
const emit = defineEmits<{ restore: [state: CvState] }>();
const revisions = ref<CareerRevision[]>([]);
const error = ref('');
function load() { try { revisions.value = props.variantId ? listCareerRevisions(props.variantId) : []; error.value = ''; } catch (e) { error.value = String(e); } }
watch(() => props.variantId, load, { immediate: true });
function checkpoint() { try { pinCareerRevision(props.variantId, props.state); load(); } catch (e) { error.value = String(e); } }
function restore(revision: CareerRevision) { try { pinCareerRevision(props.variantId, props.state); emit('restore', cloneCv(revision.state)); load(); } catch (e) { error.value = String(e); } }
</script>
<template>
  <details class="variant-history"><summary>{{ state.lang === 'de' ? 'Revisionsverlauf' : 'Revision history' }}</summary>
    <p>{{ state.lang === 'de' ? 'Speichere einen festen Stand. Bewerbungen behalten immer ihre zugewiesene Kopie.' : 'Save a checkpoint. Applications always retain their own assigned copy.' }}</p>
    <button class="btn" type="button" @click="checkpoint">{{ state.lang === 'de' ? 'Revision speichern' : 'Save checkpoint' }}</button>
    <p v-if="error" role="alert">{{ error }}</p>
    <ul><li v-for="revision in revisions.toReversed()" :key="revision.revision"><span>r{{ revision.revision }} · {{ new Date(revision.createdAt).toLocaleString() }}</span><button class="btn" type="button" @click="restore(revision)">{{ state.lang === 'de' ? 'Wiederherstellen' : 'Restore' }}</button></li></ul>
  </details>
</template>
<style scoped>
.variant-history { margin: 12px 0; padding: 12px; border: 1px solid #28534e; border-radius: 8px; }
.variant-history summary { cursor: pointer; }
.variant-history p { color: #a6c1b9; font-size: 12px; }
.variant-history ul { list-style: none; padding: 0; }
.variant-history li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; font-size: 12px; }
</style>
