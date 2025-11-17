<script setup>
import { computed, ref } from 'vue';
import { makeT } from '../i18n/dict.js';

const props = defineProps({
  title: String,
  sectionKey: String,
  lang: { type: String, default: 'de' },
  modelValue: { type: Array, required: true },
  schema: { type: Array, required: true }, // [{label,key,type,placeholder,options?}]
  addLabel: { type: String, default: 'Eintrag hinzufügen' },
  toggleable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false }
});

const langRef = computed({
  get: () => props.lang || 'de',
  set: v => props.lang = v
})
const t = makeT(langRef);

const emit = defineEmits(['update:modelValue','toggle-section']);
const items = defineModel({ default: [] });

const root = ref(null);
const toggleCollapse = () => { root.value?.classList.toggle('collapsed'); };

const add = () => {
  const o = {};
  props.schema.forEach(f => { o[f.key] = f.type === 'number' ? 0 : ''; });
  items.value.push(o);

  requestAnimationFrame(()=>{
    const el = root.value?.querySelector('.item-row:last-of-type');
    el?.scrollIntoView({ behavior:'smooth', block:'center' });
  });
};
const removeAt = (i) => items.value.splice(i,1);
</script>

<template>
  <section ref="root" class="section-group" :data-section="sectionKey" :class="{disabled}">
    <div class="section-head">
      <button class="caret mini" type="button" @click="toggleCollapse">▾</button>
      <h3>{{ title }}</h3>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button v-if="addLabel" type="button" class="mini btn--success" @click="add">{{ addLabel }}</button>
        <button v-if="toggleable" class="mini" :class="[disabled?'btn--success':'btn--danger']" type="button" @click="$emit('toggle-section')">
          {{ disabled ? t('show') : t('hide') }}
        </button>
      </div>
    </div>

    <div class="items">
      <div class="item-row" v-for="(row, i) in items" :key="i">
        <div v-if="schema.some(s=>s.type!=='textarea')" :class="['row', schema.length===2?'row-2':'', schema.length===3?'row-3':'']">
          <label v-for="f in schema.filter(s=>s.type!=='textarea')" :key="f.key">
            {{ f.label }}
            <template v-if="f.type==='text'">
              <input type="text" v-model="items[i][f.key]" :placeholder="f.placeholder||''"/>
            </template>
            <template v-else-if="f.type==='number'">
              <input type="number" v-model.number="items[i][f.key]" :placeholder="f.placeholder||''"/>
            </template>
            <template v-else-if="f.type==='select'">
              <select v-model="items[i][f.key]">
                <option v-for="opt in f.options" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </template>
          </label>
        </div>
        <label v-for="f in schema.filter(s=>s.type==='textarea')" :key="f.key">
          {{ f.label }}<textarea v-model="items[i][f.key]" :placeholder="f.placeholder||''"></textarea>
        </label>
        <div><button type="button" class="mini btn--danger" @click="removeAt(i)">{{t('remove')}}</button></div>
      </div>
    </div>
  </section>
</template>
