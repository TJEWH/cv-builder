<script setup>
import {computed, ref} from "vue";
import { makeT } from '../i18n/dict';

const props = defineProps({
  lang: { type: String, default: 'de' },
  pageFlipped: { type: Boolean, default: false },
  sectionMovementMode: { type: String, default: 'drag' } // 'drag' or 'buttons'
});

const emit = defineEmits(['update:pageFlipped', 'update:lang', 'update:sectionMovementMode', 'exportPdf', 'toggleFlip']);

const langRef = computed({
  get: ()=> props.lang ?? 'de',
  set: v  => { emit('update:lang', v); }
});
const t = makeT(langRef);

const movementMode = computed({
  get: () => props.sectionMovementMode || 'drag',
  set: v => emit('update:sectionMovementMode', v)
});

const isExporting = ref(false);

const toggleFlip = () => {
  emit('toggleFlip');
};

const handleExportPdf = async () => {
  isExporting.value = true;
  try {
    emit('exportPdf');
  } finally {
    // Keep loading state for a moment to show feedback
    setTimeout(() => {
      isExporting.value = false;
    }, 500);
  }
};
</script>

<template>
  <div class="toolbar">
    <button class="btn btn--flip" type="button" @click="toggleFlip">
      <font-awesome-icon :icon="['fas', 'book-open']" />
      {{ pageFlipped ? t('backToForm') : t('openPdf') }}
    </button>
    <button
      class="btn btn--download"
      type="button"
      @click="handleExportPdf"
      :disabled="isExporting"
    >
      <font-awesome-icon v-if="isExporting" :icon="['fas', 'spinner']" spin />
      <font-awesome-icon v-else :icon="['fas', 'download']" />
      {{ isExporting ? t('exportingPdf') : "Download" }}
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

    <div class="toggle-field">
      <span class="toggle-caption">{{ langRef === 'de' ? 'Bewegung:' : 'Movement:' }}</span>
      <button
          type="button"
          class="toggle"
          role="switch"
          :aria-checked="movementMode==='drag' ? 'true' : 'false'"
          :class="{ 'is-on': movementMode==='drag' }"
          @click="movementMode = (movementMode==='buttons' ? 'drag' : 'buttons')"
      >
        <span class="toggle-track">
          <span class="toggle-label left">
            <font-awesome-icon :icon="['fas', 'arrows-up-down']" style="font-size: 10px;" />
          </span>
          <span class="toggle-label right">
            <font-awesome-icon :icon="['fas', 'hands']" style="font-size: 10px;" />
          </span>
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
  width: 140px; height: 36px; border-radius:999px;
  background: #0c131a; border:1px solid var(--border);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.03);
}
.toggle-label{ font-size:11px; opacity:.75; color:#cbd5e1; z-index:1; user-select:none; }
.toggle-thumb{
  position:absolute; top:2px; left:2px;
  width: 68px; height: 30px; border-radius:999px;
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
.toggle.is-on .toggle-thumb{ transform: translateX(66px); }

.toolbar {
  position: fixed;
  top: 30px;
  display: flex;
  right: 30px;
  width: 170px;
  z-index: 10;
  gap: 5px;
  flex-direction: column;
  background: #ffffff0f;
  padding: 15px;
  border-radius: 15px;

  button {
    width: 100%;
  }
}

/* Page flip button */
.btn--flip {
  background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  border-color: #6366f1;
  color: #fff;
  font-weight: 600;
  font-size: 15px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.3s ease;
}

.btn--flip:hover:not(:disabled) {
  background: linear-gradient(135deg, #818cf8 0%, #6366f1 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
}

/* Download PDF button - large and prominent */
.btn--download {
  background: linear-gradient(135deg, #0f766e 0%, #134e4a 100%);
  border-color: #0f766e;
  color: #9be8c7;
  font-weight: 700;
  font-size: 16px;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: all 0.3s ease;
  box-shadow: 0 4px 12px rgba(15, 118, 110, 0.3);
}

.btn--download:hover:not(:disabled) {
  background: linear-gradient(135deg, #14b8a6 0%, #0f766e 100%);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(15, 118, 110, 0.5);
}

.btn--download:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

span.toggle-caption {display: none}
</style>