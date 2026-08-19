<script setup>
import { computed } from 'vue';
import { makeT } from '../i18n/dict';

const props = defineProps({
  lang: { type: String, default: 'de' },
  previewMode: { type: Boolean, required: true },
  isExporting: { type: Boolean, default: false },
  sectionMovementMode: { type: String, default: 'drag' },
});

const emit = defineEmits(['update:lang', 'update:sectionMovementMode', 'exportPdf', 'togglePreview']);

const langRef = computed({
  get: () => props.lang ?? 'de',
  set: (value) => emit('update:lang', value),
});
const movementMode = computed({
  get: () => props.sectionMovementMode || 'drag',
  set: (value) => emit('update:sectionMovementMode', value),
});
const t = makeT(langRef);
</script>

<template>
  <nav class="toolbar" aria-label="CV actions">
    <button class="btn btn--primary" type="button" @click="emit('togglePreview')">
      {{ previewMode ? t('backToBuilder') : t('openPreview') }}
    </button>
    <button class="btn btn--primary" type="button" @click="emit('exportPdf')" :disabled="isExporting">
      <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
      {{ isExporting ? t('exportingPdf') : t('downloadPdf') }}
    </button>

    <template v-if="!previewMode">
      <div class="toggle-field">
        <span class="toggle-caption">{{ t('languageCaption') }}:</span>
        <button
          type="button"
          class="toggle"
          role="switch"
          :aria-checked="langRef === 'en'"
          :class="{ 'is-on': langRef === 'en' }"
          @click="langRef = (langRef === 'de' ? 'en' : 'de')"
        >
          <span class="toggle-track">
            <span class="toggle-label left">DE</span>
            <span class="toggle-label right">EN</span>
            <span class="toggle-thumb"></span>
          </span>
        </button>
      </div>

      <div class="toggle-field">
        <span class="toggle-caption">{{ langRef === 'de' ? 'Bewegung:' : 'Movement:' }}</span>
        <button
          type="button"
          class="toggle"
          role="switch"
          :aria-checked="movementMode === 'drag'"
          :class="{ 'is-on': movementMode === 'drag' }"
          @click="movementMode = (movementMode === 'buttons' ? 'drag' : 'buttons')"
        >
          <span class="toggle-track">
            <span class="toggle-label left"><font-awesome-icon :icon="['fas', 'arrows-up-down']" style="font-size: 10px;" /></span>
            <span class="toggle-label right"><font-awesome-icon :icon="['fas', 'hands']" style="font-size: 10px;" /></span>
            <span class="toggle-thumb"></span>
          </span>
        </button>
      </div>
    </template>
  </nav>
</template>

<style>
.toggle-field { display: flex; align-items: center; gap: 8px; }
.toggle-caption { font-size: 12px; color: var(--muted); }
.toggle { border: 0; background: transparent; padding: 0; cursor: pointer; outline: none; }
.toggle-track {
  position: relative; display: inline-flex; align-items: center; justify-content: space-around;
  width: 140px; height: 36px; border-radius: 999px;
  background: #0c131a; border: 1px solid var(--border);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
}
.toggle-label { font-size: 11px; opacity: .75; color: #cbd5e1; z-index: 1; user-select: none; }
.toggle-thumb {
  position: absolute; top: 2px; left: 2px; width: 68px; height: 30px; border-radius: 999px;
  background: linear-gradient(180deg, rgba(255,255,255,.09), rgba(255,255,255,.02));
  border: 1px solid rgba(255,255,255,.12); transition: transform .18s ease;
}
.toggle:not(.is-on) .toggle-track { background: linear-gradient(180deg, rgba(99,102,241,.22), rgba(59,130,246,.14)); border-color: rgba(59,130,246,.45); }
.toggle.is-on .toggle-track { background: linear-gradient(180deg, rgba(34,197,94,.25), rgba(16,185,129,.15)); border-color: rgba(16,185,129,.45); }
.toggle.is-on .toggle-thumb { transform: translateX(66px); }

.toolbar {
  position: fixed; top: 30px; right: 30px; z-index: 10;
  display: flex; flex-direction: column; gap: 5px; width: 170px;
  padding: 15px; border-radius: 15px; background: #ffffff0f;
}
.toolbar button { width: 100%; }
.toolbar .toggle { width: auto; }
.toolbar .toggle-field { justify-content: center; }
.toolbar .toggle-caption { display: none; }

@media (max-width: 1180px) {
  .toolbar { top: 12px; right: 12px; width: auto; flex-direction: row; align-items: center; }
  .toolbar .toggle-field { display: none; }
  .toolbar button { width: auto; }
}
</style>
