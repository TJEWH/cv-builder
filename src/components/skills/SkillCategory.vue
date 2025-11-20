<script setup>
import { computed } from 'vue';
import SkillItem from './SkillItem.vue';

const props = defineProps({
  title: { type: String, required: true },
  items: { type: Array, default: () => [] },
  levelType: { type: String, default: null },
  sidebarColor: { type: String, default: '#ffffff' }
});

// Prüfe ob die Kategorie kein Level hat (null oder leer)
const showAsBadges = computed(() => {
  return !props.levelType || props.levelType === '';
});
</script>

<template>
  <div class="skill-category">
    <h3 class="small">{{ title }}</h3>

    <!-- Badge-Darstellung wenn Kategorie kein Level hat -->
    <div v-if="showAsBadges" class="tags">
      <span v-for="(item, idx) in items" :key="idx" class="tag">{{ item.name }}</span>
    </div>

    <!-- Liste mit individuellen Level-Anzeigen -->
    <div v-else class="skill-items-list">
      <SkillItem
        v-for="(item, idx) in items"
        :key="idx"
        :name="item.name"
        :levelType="levelType"
        :levelValue="item.levelValue || 0"
        :sidebarColor="sidebarColor"
      />
    </div>
  </div>
</template>

<style scoped>
.skill-category {
  margin-top: 4mm;
}

.skill-items-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
</style>

