<script setup>
import MarkdownContent from './MarkdownContent.vue';
import { hasMarkdownText } from '../composables/markdownText.js';

defineProps({
  kind: { type: String, required: true },
  item: { type: Object, required: true },
  meta: { type: String, default: '' },
  anonymized: { type: Boolean, default: false },
  institution: { type: Boolean, default: false },
  showTitle: { type: Boolean, default: true },
  showDescription: { type: Boolean, default: true },
});
</script>

<template>
  <article class="item" :class="{ 'education-item': kind === 'education', 'custom-body-item': kind === 'custom', 'custom-body-item--with-institution': kind === 'custom' && institution }">
    <template v-if="kind === 'jobs'">
      <h3 class="item-title">{{ item.title }}</h3>
      <div class="item-sub">{{ item.company }}</div>
      <div class="item-meta">{{ meta }}</div>
      <MarkdownContent :value="item.bullets" :anonymized="anonymized" />
    </template>
    <template v-else-if="kind === 'education'">
      <h3 class="item-title">{{ item.title }}</h3>
      <div class="item-sub">{{ item.sub }}</div>
      <div class="item-meta">{{ meta }}</div>
      <div v-if="hasMarkdownText(item.thesis) || hasMarkdownText(item.coursesText)" class="education-details">
        <div v-if="hasMarkdownText(item.thesis)" class="education-thesis"><MarkdownContent :value="item.thesis" :anonymized="anonymized" /></div>
        <div v-if="hasMarkdownText(item.coursesText)" class="education-courses"><MarkdownContent :value="item.coursesText" :anonymized="anonymized" /></div>
      </div>
    </template>
    <template v-else>
      <h3 v-if="showTitle" class="item-title">{{ item.title }}</h3>
      <div v-if="institution" class="item-sub">{{ item.institution }}</div>
      <div v-if="meta" class="item-meta">{{ meta }}</div>
      <MarkdownContent v-if="showDescription" :value="item.desc" :anonymized="anonymized" />
    </template>
  </article>
</template>
