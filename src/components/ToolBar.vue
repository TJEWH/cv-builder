<script setup>
import {computed} from "vue";
import { makeT } from '../i18n/dict';

const props = defineProps({
  lang: { type: String, default: 'de' },
  showPreview: { type: Boolean, required: true }
});

const emit = defineEmits(['update:showPreview']);

const lang = computed({
  get: ()=> props.lang ?? 'de',
  set: v  => { props.lang = v; }
});
const t = makeT(lang);

const preview = computed({
  get: () => props.showPreview,
  set: v => emit('update:showPreview', v)
});

const openPreviewTab = () => window.open('/preview.html', '_blank', 'noopener');
</script>

<template>
  <div class="toolbar">
    <button class="btn btn--primary" type="button" @click="openPreviewTab">{{t('openPdf')}}</button>
    <button class="btn" :class="[preview?'btn--danger':'btn--success']" type="button" @click="preview = !preview">
      {{ preview ? t('hidePreview') : t('showPreview') }}
    </button>
    <!--<span class="note">{{ status }}</span>-->
  </div>
</template>

<style scoped>

</style>