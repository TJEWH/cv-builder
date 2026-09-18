<script setup lang="ts">
import { computed } from 'vue';
import type { CvDesign } from '../types';
import type { DesignControl, DesignControlRow, FavoriteLink, StringDesignKey } from '../composables/designControls';
import { DEFAULT_DESIGN, designValue, designNumber } from '../defaults';
import { makeT } from '../i18n/dict';
const props = defineProps<{ modelValue: CvDesign; entries: DesignControlRow[]; lang: string }>();
const t = makeT(computed(() => props.lang));
const design = computed(() => new Proxy(props.modelValue, {
  get: (target, key) => key in DEFAULT_DESIGN ? designValue(target, key as keyof CvDesign) : Reflect.get(target, key),
}) as Required<CvDesign>);
function shortLabel(option: DesignControl) {
  return ({
    pageMarginTop: t('designTop'), pageMarginBottom: t('designBottom'),
    pageMarginRight: t('designRight'), pageMarginLeft: t('designLeft'),
    headerPaddingBottom: t('designPadding'), headerBottomMargin: t('designMargin'),
  } as Partial<Record<keyof CvDesign, string>>)[option.key] || option.label;
}
function controlValue(option: DesignControl) {
  const value = design.value[option.key];
  if (option.type !== 'range') return value;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : designNumber({}, option.key);
}
function valueLabel(option: DesignControl) {
  const value = controlValue(option);
  return option.type === 'range' ? `${value}${option.unit || option.suffix || ''}` : value;
}
function setControlValue(option: DesignControl, value: string | number | boolean) {
  if (option.type === 'toggle') {
    design.value[option.key] = Boolean(value);
    return;
  }
  if (option.type !== 'range') {
    design.value[option.key] = String(value);
    return;
  }

  if (option.unit !== undefined) {
    const nextValue = `${value}${option.unit}`;
    design.value[option.key] = nextValue;
    if (option.link && isLinked(option.link.linkKey)) {
      const pairedKey = option.link.primaryKey === option.key ? option.link.secondaryKey : option.link.primaryKey;
      design.value[pairedKey] = nextValue;
    }
  } else {
    design.value[option.key] = Number(value);
  }
}
function toggleLink(link: FavoriteLink) {
  const { linkKey, primaryKey, secondaryKey } = link;
  setLinked(linkKey, primaryKey, secondaryKey, !isLinked(linkKey));
}
function isLinked(key: FavoriteLink['linkKey']) {
  return designValue(design.value, key);
}

function setLinked(key: FavoriteLink['linkKey'], primaryKey: StringDesignKey, secondaryKey: StringDesignKey, linked: boolean) {
  design.value[key] = linked;
  if (linked) design.value[secondaryKey] = design.value[primaryKey];
}

</script>

<template>
          <div class="design-controls">
            <template v-for="entry in entries" :key="entry.type === 'linked' ? entry.key : entry.option.key">
              <div v-if="entry.type === 'linked'" class="design-control design-control--linked">
                <div class="design-paired-controls">
                  <div class="design-linked-slider">
                    <div class="design-linked-slider-heading">
                      <span>{{ isLinked(entry.link.linkKey) ? entry.label : shortLabel(entry.options[0]) }}: {{ valueLabel(entry.options[0]) }}</span>
                      <button class="mini link-toggle" type="button" :aria-label="t(isLinked(entry.link.linkKey) ? 'unlinkControls' : 'linkControls').replace('{label}', entry.label)" :aria-pressed="isLinked(entry.link.linkKey)" @click="toggleLink(entry.link)"><font-awesome-icon :icon="['fas', isLinked(entry.link.linkKey) ? 'link' : 'link-slash']" /></button>
                    </div>
                    <input type="range" :aria-label="isLinked(entry.link.linkKey) ? entry.label : entry.options[0].label" :min="entry.options[0].min" :max="entry.options[0].max" :step="entry.options[0].step" :value="controlValue(entry.options[0])" @input="setControlValue(entry.options[0], ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  </div>
                  <label v-if="!isLinked(entry.link.linkKey)">
                    <span>{{ shortLabel(entry.options[1]) }}: {{ valueLabel(entry.options[1]) }}</span>
                    <input type="range" :aria-label="entry.options[1].label" :min="entry.options[1].min" :max="entry.options[1].max" :step="entry.options[1].step" :value="controlValue(entry.options[1])" @input="setControlValue(entry.options[1], ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  </label>
                </div>
              </div>
              <div v-else class="design-control">
                <div class="design-control-label"><span>{{ entry.option.label }}<template v-if="entry.option.type === 'range'">: {{ valueLabel(entry.option) }}</template></span></div>
                <input v-if="entry.option.type === 'toggle'" class="design-toggle" type="checkbox" role="switch" :aria-label="entry.option.label" :checked="Boolean(controlValue(entry.option))" @change="setControlValue(entry.option, ($event.target as HTMLInputElement).checked)">
                <input v-else-if="entry.option.type === 'range'" type="range" :aria-label="entry.option.label" :min="entry.option.min" :max="entry.option.max" :step="entry.option.step" :value="String(controlValue(entry.option))" @input="setControlValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                <input v-else-if="entry.option.type === 'color'" type="color" :aria-label="entry.option.label" :value="String(controlValue(entry.option))" @input="setControlValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                <select v-else :aria-label="entry.option.label" :value="String(controlValue(entry.option))" @change="setControlValue(entry.option, ($event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value)">
                  <option v-for="choice in entry.option.options" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                </select>
              </div>
            </template>
          </div>
</template>

<style scoped>
.design-controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
.design-control { display: grid; gap: 4px; align-content: start; }
.design-control--linked { grid-column: span 2; }
.design-control-label { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: #78d1b8; font-size: 10pt; }
.design-paired-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.design-linked-slider { display: grid; gap: 4px; }
.design-linked-slider-heading { display: flex; align-items: center; gap: 6px; color: #78d1b8; font-size: 10pt; }
.design-paired-controls label { display: grid; gap: 4px; color: #78d1b8; font-size: 10pt; }
.link-toggle { flex: 0 0 auto; width: 28px; min-width: 28px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.link-toggle[aria-pressed="true"] { border-color: #27f3a2; color: #9be8c7; }
.design-toggle { width: 16px; height: 16px; accent-color: #27f3a2; }
@media (max-width: 640px) { .design-controls, .design-paired-controls { grid-template-columns: 1fr; } .design-control--linked { grid-column: auto; } }
</style>
