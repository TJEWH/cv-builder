<script setup>
import { computed, reactive } from 'vue'
import { makeT } from '../i18n/dict.js';
import sectionIcons from '../i18n/sectionIcons.js';

const props = defineProps({
  modelValue: { type: Array, required: true }, // [{label, desc, refs:[]}]
  options: { type: Array, default: () => [] }  // [{id,label}]
})
const emit = defineEmits(['update:modelValue'])

const langRef = computed({
  get: () => props.state.lang || 'de',
  set: v => props.state.lang = v
});
const t = makeT(langRef);

const skills = computed({
  get: () => Array.isArray(props.modelValue) ? props.modelValue : [],
  set: (v) => emit('update:modelValue', Array.isArray(v) ? v : [])
})

/* Collapse-State je Zeile */
const open = reactive({})
const collapsed = reactive({ header:false, about:false, soft:false });

const getIcon = (key) => sectionIcons[key] || 'folder-open';

const ensureRow = (idx) => {
  if (!skills.value[idx]) {
    const arr = skills.value.slice()
    arr[idx] = { label: '', desc: '', refs: [] }
    skills.value = arr
  } else if (!Array.isArray(skills.value[idx].refs)) {
    const arr = skills.value.slice()
    arr[idx] = { ...arr[idx], refs: [] }
    skills.value = arr
  }
}

const addSkill = () => {
  const arr = skills.value.slice()
  arr.push({ label: '', desc: '', refs: [] })
  skills.value = arr
}

const removeSkill = (idx) => {
  const arr = skills.value.slice()
  arr.splice(idx, 1)
  skills.value = arr
}

const toggleRef = (idx, refId) => {
  ensureRow(idx)
  const row = { ...skills.value[idx] }
  const refs = Array.isArray(row.refs) ? row.refs.slice() : []
  const i = refs.indexOf(refId)
  if (i >= 0) refs.splice(i, 1)
  else refs.push(refId)
  row.refs = refs

  const arr = skills.value.slice()
  arr[idx] = row
  skills.value = arr
}

const covered = (idx) => (skills.value[idx]?.refs?.length || 0) > 0
const rowClass = (idx, refId) =>
    (skills.value[idx]?.refs || []).includes(refId) ? 'skill-row selected' : 'skill-row'
</script>

<template>
  <section class="section-group" data-section="softSkills" :class="{collapsed:collapsed.soft}">
    <div class="section-head">
      <button class="caret mini" type="button" @click="collapsed.soft=!collapsed.soft">
        <font-awesome-icon :icon="['fas', getIcon('softSkills')]" class="section-icon" aria-hidden="true" />
      </button>
      <h3>{{ t('softSkillsTitle') }}</h3>
    </div>

    <div class="items">
      <!-- Falls leer: Add-CTA -->
      <div v-if="!skills.length" class="item-row empty" style="margin:8px 0;">
        <button type="button" class="mini btn btn--success" @click="addSkill">+ Soft Skill hinzufügen</button>
      </div>

      <div
          class="item-row"
          v-for="(s, idx) in skills"
          :key="idx"
          :style="{border:'1px solid', borderColor: covered(idx)?'var(--valid, #22c55e)':'var(--invalid, #ef4444)', borderRadius:'8px', padding:'8px', margin:'8px 0'}"
      >
        <div class="section-head" style="margin:0 0 6px;gap:8px; display:flex; align-items:center">
          <button class="caret mini" type="button" @click="open[idx] = !open[idx]">▾</button>
          <label style="flex:1">Soft Skill
            <input type="text" v-model="s.label" placeholder="Communication" />
          </label>
          <button class="mini btn btn--danger" type="button" title="Entfernen" @click="removeSkill(idx)">✕</button>
        </div>

        <div class="skill-boxes" v-show="open[idx] !== false || !covered(idx)">
          <div
              v-for="o in options" :key="o.id"
              :class="rowClass(idx,o.id)"
              tabindex="0"
              @click="toggleRef(idx,o.id)"
              @keydown.prevent.space.enter="toggleRef(idx,o.id)"
              style="padding:6px 8px; border:1px dashed var(--border,#334155); border-radius:6px; margin:4px 0; cursor:pointer"
          >
            • {{ o.label }}
          </div>
          <div v-if="!options.length" class="small" style="opacity:.7; margin-top:4px">
            (Keine Referenz-Items verfügbar – füge Einträge in Erfahrung/Ausbildung/Projekte/Custom hinzu.)
          </div>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end; gap:8px; margin-top:8px">
        <button type="button" class="btn btn--success mini" @click="addSkill">+ Soft Skill</button>
      </div>
    </div>
  </section>
</template>
