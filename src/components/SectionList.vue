<script setup>
const props = defineProps({
  title: String,
  sectionKey: String,
  modelValue: { type: Array, required: true },
  schema: { type: Array, required: true }, // [{label,key,type,placeholder,options?}]
  addLabel: { type: String, default: 'Eintrag hinzufügen' },
  toggleable: { type: Boolean, default: true },
  disabled: { type: Boolean, default: false } // zeigt, ob Sektion ausgeblendet ist
});
const emit = defineEmits(['update:modelValue','toggle-section']);
const items = defineModel({ default: [] });

const add = () => {
  const o = {};
  props.schema.forEach(f => { o[f.key] = f.type === 'number' ? 0 : ''; });
  items.value.push(o);
};
const removeAt = (i) => items.value.splice(i,1);
</script>

<template>
  <section class="section-group" :data-section="sectionKey" :class="{disabled}">
    <div class="section-head">
      <button class="caret mini" type="button" @click="$el.parentElement.classList.toggle('collapsed')">▾</button>
      <h3>{{ title }}</h3>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button v-if="addLabel" type="button" class="mini btn--success" @click="add">{{ addLabel }}</button>
        <button v-if="toggleable" class="mini" :class="[disabled?'btn--success':'btn--danger']" type="button" @click="$emit('toggle-section')">
          {{ disabled ? 'Einblenden' : 'Ausblenden' }}
        </button>
      </div>
    </div>

    <div class="items">
      <div class="item-row" v-for="(i) in items" :key="i">
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
        <div><button type="button" class="mini btn--danger" @click="removeAt(i)">Entfernen</button></div>
      </div>
    </div>
  </section>
</template>
