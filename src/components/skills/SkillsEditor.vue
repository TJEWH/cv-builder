<script setup>
import { computed } from 'vue';
import { makeT } from '../../i18n/dict.ts';

const props = defineProps({
  modelValue: { type: Array, default: () => [] },
  lang: { type: String, default: 'de' }
});

const emit = defineEmits(['update:modelValue']);

const langRef = computed({ get: () => props.lang || 'de' });
const t = makeT(langRef);

const categories = computed({
  get: () => {
    // Stelle sicher dass modelValue ein Array ist
    if (!Array.isArray(props.modelValue)) {
      return [];
    }
    return props.modelValue;
  },
  set: (val) => emit('update:modelValue', val)
});

const addCategory = () => {
  const newCat = {
    title: '',
    levelType: null,
    items: []
  };
  const updated = [...categories.value, newCat];
  emit('update:modelValue', updated);
};

const removeCategory = (idx) => {
  const updated = categories.value.filter((_, i) => i !== idx);
  emit('update:modelValue', updated);
};

const addItem = (catIdx) => {
  const updated = [...categories.value];
  if (!updated[catIdx].items) {
    updated[catIdx].items = [];
  }
  updated[catIdx].items.push({
    name: '',
    levelValue: 0
  });
  emit('update:modelValue', updated);
};

const removeItem = (catIdx, itemIdx) => {
  const updated = [...categories.value];
  updated[catIdx].items = updated[catIdx].items.filter((_, i) => i !== itemIdx);
  emit('update:modelValue', updated);
};

// Hilfsfunktion für reactive Updates
const updateCategory = (catIdx, field, value) => {
  const updated = categories.value.map((cat, idx) => {
    if (idx !== catIdx) return cat;
    return { ...cat, [field]: value };
  });
  emit('update:modelValue', updated);
};

const updateItem = (catIdx, itemIdx, field, value) => {
  const updated = categories.value.map((cat, idx) => {
    if (idx !== catIdx) return cat;
    return {
      ...cat,
      items: cat.items.map((item, iIdx) => {
        if (iIdx !== itemIdx) return item;
        return { ...item, [field]: value };
      })
    };
  });
  emit('update:modelValue', updated);
};
</script>

<template>
  <div class="skills-editor">
    <div class="category-list">
      <div v-for="(cat, catIdx) in categories" :key="catIdx" class="category-block">
        <div class="category-header">
          <input
            :value="cat.title"
            @input="updateCategory(catIdx, 'title', $event.target.value)"
            type="text"
            :placeholder="langRef === 'de' ? 'Kategorie-Name (z.B. Programmiersprachen)' : 'Category Name'"
            class="category-title-input"
          />
          <label class="category-level-type">
            <span class="field-label">{{ langRef === 'de' ? 'Level-Typ' : 'Level Type' }}</span>
            <select
              :value="cat.levelType"
              @change="updateCategory(catIdx, 'levelType', $event.target.value === 'null' ? null : $event.target.value)"
              class="level-type-select"
            >
              <option value="null">{{ langRef === 'de' ? 'Kein Level (Badge)' : 'No Level (Badge)' }}</option>
              <option value="experience">{{ langRef === 'de' ? 'Erfahrung (1-10)' : 'Experience (1-10)' }}</option>
              <option value="years">{{ langRef === 'de' ? 'Jahre' : 'Years' }}</option>
            </select>
          </label>
          <button type="button" class="mini btn--danger" @click="removeCategory(catIdx)">
            {{ langRef === 'de' ? 'Löschen' : 'Delete' }}
          </button>
        </div>

        <div class="items-list">
          <div v-for="(item, itemIdx) in cat.items" :key="itemIdx" class="item-row-skill">
            <label class="item-field">
              <span class="field-label">Name</span>
              <input
                :value="item.name"
                @input="updateItem(catIdx, itemIdx, 'name', $event.target.value)"
                type="text"
                :placeholder="langRef === 'de' ? 'z.B. Python' : 'e.g. Python'"
              />
            </label>

            <label class="item-field" v-if="cat.levelType">
              <span class="field-label">{{ langRef === 'de' ? 'Level-Wert' : 'Level Value' }}</span>
              <input
                :value="item.levelValue"
                @input="updateItem(catIdx, itemIdx, 'levelValue', Number($event.target.value))"
                type="number"
                :placeholder="cat.levelType === 'years' ? 'z.B. 5' : '1-10'"
                :min="cat.levelType === 'experience' ? 1 : 0"
                :max="cat.levelType === 'experience' ? 10 : 99"
              />
            </label>

            <button type="button" class="mini btn--danger" @click="removeItem(catIdx, itemIdx)">
              {{ langRef === 'de' ? 'Entfernen' : 'Remove' }}
            </button>
          </div>

          <div v-if="!cat.items || cat.items.length === 0" class="empty-state">
            {{ langRef === 'de' ? 'Keine Fähigkeiten. Klicke auf "Hinzufügen"' : 'No skills. Click "Add"' }}
          </div>
          <div class="add-button-wrapper">
            <button type="button" class="add-button mini btn--success" @click="addItem(catIdx)">{{ langRef === 'de' ? '+ Fähigkeit' : '+ Skill' }}</button>
          </div>
        </div>
      </div>
    </div>

    <div class="add-button-wrapper">
      <button type="button" class="add-button mini btn--success" @click="addCategory">
        {{ langRef === 'de' ? '+ Kategorie hinzufügen' : '+ Add Category' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.skills-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.category-block {
  border: 2px solid #134e4a;
  border-radius: 4px;
  padding: 12px;
  background: #134e4a;
}

.category-header {
  display: flex;
  gap: 8px;
  align-items: end;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.category-title-input {
  flex: 1;
  min-width: 200px;
  background: transparent;
  border: 1px solid #10b981;
  color: #9be8c7;
  padding: 6px 10px;
  border-radius: 4px;
}

.category-level-type {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.level-type-select {
  padding: 6px 10px;
  border: 1px solid #134e4a;
  background: #061017;
  color: #9be8c7;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.level-type-select:hover {
  border-color: #10b981;
}

.level-type-select:focus {
  outline: none;
  border-color: #10b981;
}

.items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-row-skill {
  display: grid;
  grid-template-columns: 2fr 1fr auto;
  gap: 8px;
  align-items: end;
  padding: 8px;
  background: #0a1a20;
  border: 1px solid #134e4a;
  border-radius: 6px;
}

.item-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-label {
  font-size: 0.85rem;
  color: #9be8c7;
  font-weight: 500;
}

.empty-state {
  padding: 16px;
  text-align: center;
  color: #5dd6b5;
  font-style: italic;
  opacity: 0.7;
}
</style>

