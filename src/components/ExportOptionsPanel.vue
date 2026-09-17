<script setup>
import { computed } from 'vue';
import { makeT } from '../i18n/dict';
import { normalizeExportOptions } from '../composables/pdfImageEncoding';

const props = defineProps({
  modelValue: { type: Object, default: () => ({ format: 'png', quality: 100 }) },
  estimateSize: { type: String, default: '' },
  isEstimateQualityScaled: { type: Boolean, default: false },
  estimateReferenceQuality: { type: Number, default: null },
  isExactEstimating: { type: Boolean, default: false },
  isEstimateStale: { type: Boolean, default: false },
  estimateError: { type: String, default: '' },
  lang: { type: String, default: 'de' },
});

const emit = defineEmits(['update:modelValue', 'exactEstimate']);
const options = computed(() => normalizeExportOptions(props.modelValue));
const langRef = computed(() => props.lang || 'de');
const t = makeT(langRef);

function updateOption(key, value) {
  emit('update:modelValue', normalizeExportOptions({ ...options.value, [key]: value }));
}

const qualityLabel = computed(() => {
  if (options.value.format === 'png') {
    return options.value.quality === 100 ? t('losslessPng') : t('pngPaletteCompression');
  }
  return t('imageQuality');
});

</script>

<template>
  <section class="section-group editor-panel export-options-panel">
    <div class="section-head editor-panel__header editor-panel__header--centered">
      <h2>{{ t('export') }}</h2>
      <button class="mini panel-header-action export-options-panel__exact" type="button" :disabled="isExactEstimating" @click="$emit('exactEstimate')">
        <font-awesome-icon :icon="['fas', isExactEstimating ? 'spinner' : 'calculator']" :spin="isExactEstimating" />
        {{ t('exactEstimate') }}
      </button>
    </div>

    <div class="editor-panel__body">
      <div class="grid-2">
        <label>{{ t('exportFormat') }}
          <select :value="options.format" @change="updateOption('format', $event.target.value)">
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
            <option value="vector">{{ t('vectorPdf') }}</option>
          </select>
        </label>
        <label v-if="options.format !== 'vector'">{{ qualityLabel }}: {{ options.quality }}%
          <input type="range" min="80" max="100" step="1" :value="options.quality" @input="updateOption('quality', $event.target.value)">
        </label>
      </div>
      <p v-if="options.format === 'vector'" class="export-options-panel__hint">{{ t('vectorPdfHelp') }}</p>

      <div class="export-estimate subsection-row" :class="{ 'export-estimate--stale': isEstimateStale, 'export-estimate--error': estimateError }">
        <span>{{ t('estimatedPdfSize') }}: </span>
        <strong v-if="estimateSize">{{ estimateSize }}</strong>
        <strong v-else-if="isExactEstimating">{{ t('calculatingEstimate') }}</strong>
        <strong v-else>{{ t('estimateUnavailable') }}</strong>
        <span v-if="estimateSize && !isExactEstimating" class="export-estimate__accuracy">
          {{ isEstimateQualityScaled ? t('qualityScaledEstimate') : t('lastCachedEstimate') }}<template v-if="isEstimateQualityScaled && estimateReferenceQuality != null"> ({{ estimateReferenceQuality }}%)</template>
        </span>
        <span v-else-if="estimateSize" class="export-estimate__accuracy">{{ t('calculatingEstimate') }}</span>
        <span v-if="isEstimateStale && !isExactEstimating" class="export-estimate__stale">{{ t('estimateStaleContent') }}</span>
      </div>
      <p v-if="estimateError" class="export-estimate__error">{{ estimateError }}</p>
    </div>
  </section>
</template>

<style scoped>
.export-estimate { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; color: #d7e1eb; font-size: 12px; }
.export-estimate--stale { color: #f0cd86; }
.export-estimate--error { color: #ffaaaa; }
.export-estimate__accuracy { color: var(--muted); font-size: 11px; }
.export-estimate__stale { color: #f0cd86; font-size: 11px; }
.export-options-panel__exact { white-space: nowrap; }
.export-options-panel__hint { margin: 8px 0 12px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.export-estimate__error { margin: 6px 0 0; color: #ffaaaa; font-size: 11px; }
</style>
