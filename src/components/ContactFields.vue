<script setup lang="ts">
import { computed } from 'vue';
import type { Contact } from '../types';
import { SAMPLE_CONTACT } from '../defaults';
import { makeT } from '../i18n/dict';
const props = defineProps<{ contact: Contact; lang: string }>();
const t = makeT(computed(() => props.lang));
</script>

<template>
  <div class="contact-fields">
    <div class="grid-2"><label>{{ t('location') }}<InputText v-model="contact.location" :placeholder="SAMPLE_CONTACT.location" fluid /></label><label>{{ t('email') }}<InputText v-model="contact.email" type="email" :placeholder="SAMPLE_CONTACT.email" fluid /></label></div>
    <div class="grid-2"><label>{{ t('phone') }}<InputText v-model="contact.phone" type="tel" :placeholder="SAMPLE_CONTACT.phone" fluid /></label><label>{{ t('website') }}<InputText v-model="contact.website" type="url" :placeholder="SAMPLE_CONTACT.website" fluid /></label></div>
    <div class="grid-2"><label>{{ t('linkedin') }}<InputText v-model="contact.linkedin" type="url" :placeholder="SAMPLE_CONTACT.linkedin" fluid /></label><label>{{ t('github') }}<InputText v-model="contact.github" type="url" :placeholder="SAMPLE_CONTACT.github" fluid /></label></div>
  </div>
</template>

<style scoped>
.contact-fields { display: grid; gap: 8px; min-width: 0; }
</style>
