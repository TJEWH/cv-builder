<script setup>
import { reactive } from 'vue';

const props = defineProps({
  modelValue: { type: Array, required: true }, // [{label,desc,refs:[]}]
  options: { type: Array, default: ()=>[] }     // [{id,label}]
});
const emit = defineEmits(['update:modelValue']);
const skills = defineModel({ default: [] });

const open = reactive({}); // collapse state pro index

const toggleRef = (idx, refId)=>{
  const arr = skills.value[idx].refs ?? (skills.value[idx].refs = []);
  const i = arr.indexOf(refId);
  if(i>=0) arr.splice(i,1); else arr.push(refId);
};

const covered = (idx)=> (skills.value[idx]?.refs?.length||0) > 0;
const rowClass = (idx, refId)=> (skills.value[idx]?.refs||[]).includes(refId) ? 'skill-row selected' : 'skill-row';
</script>

<template>
  <div class="items">
    <div class="item-row" v-for="(s, idx) in skills" :key="idx" :style="{borderColor: covered(idx)?'var(--valid)':'var(--invalid)'}">
      <div class="section-head" style="margin:0 0 6px;gap:8px">
        <button class="caret mini" type="button" @click="open[idx]=!open[idx]">▾</button>
        <label style="flex:1">Soft Skill
          <input type="text" v-model="s.label" placeholder="Communications"/>
        </label>
      </div>

      <div class="skill-boxes" v-show="open[idx] !== false || !covered(idx)">
        <div
            v-for="o in options" :key="o.id"
            :class="rowClass(idx,o.id)"
            tabindex="0"
            @click="toggleRef(idx,o.id)"
            @keydown.prevent.space.enter="toggleRef(idx,o.id)"
        >• {{ o.label }}</div>
      </div>
    </div>
  </div>
</template>
