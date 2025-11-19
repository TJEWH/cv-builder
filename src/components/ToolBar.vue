<script setup>
import {computed} from "vue";
import { makeT } from '../i18n/dict';

const props = defineProps({
  lang: { type: String, default: 'de' },
  showPreview: { type: Boolean, required: true }
});

const emit = defineEmits(['update:showPreview', 'update:lang']);

const langRef = computed({
  get: ()=> props.lang ?? 'de',
  set: v  => { emit('update:lang', v); }
});
const t = makeT(langRef);

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

    <div class="toggle-field">
      <span class="toggle-caption">{{ t('languageCaption') }}:</span>
      <button
          type="button"
          class="toggle"
          role="switch"
          :aria-checked="langRef==='en' ? 'true' : 'false'"
          :class="{ 'is-on': langRef==='en' }"
          @click="langRef = (langRef==='de' ? 'en' : 'de')"
      >
        <span class="toggle-track">
          <span class="toggle-label left">DE</span>
          <span class="toggle-label right">EN</span>
          <span class="toggle-thumb"></span>
        </span>
      </button>
    </div>
  </div>
</template>

<style> /* unscoped to apply on storage switch -->*/
.toggle-field{ display:flex; align-items:center; gap:8px; }
.toggle-caption{ font-size:12px; color: var(--muted); }

.toggle{
  border:0; background:transparent; padding:0; cursor:pointer; outline:none;
}
.toggle-track{
  position:relative; display:inline-flex; align-items:center; justify-content:space-around;
  width: 120px; height: 36px; border-radius:999px;
  background: #0c131a; border:1px solid var(--border);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
}
.toggle-label{ font-size:11px; opacity:.75; color:#cbd5e1; z-index:1; user-select:none; }
.toggle-thumb{
  position:absolute; top:2px; left:2px;
  width: 58px; height: 30px; border-radius:999px;
  background:linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.02));
  border:1px solid rgba(255,255,255,.12);
  transition: transform .18s ease;
}

/* States / Colors (retro CLI) */
.toggle:not(.is-on) .toggle-track{
  background: linear-gradient(180deg, rgba(99,102,241,.22), rgba(59,130,246,.14));
  border-color: rgba(59,130,246,.45);
}
.toggle.is-on .toggle-track{
  background: linear-gradient(180deg, rgba(34,197,94,.25), rgba(16,185,129,.15));
  border-color: rgba(16,185,129,.45);
}
.toggle.is-on .toggle-thumb{ transform: translateX(56px); }
</style>