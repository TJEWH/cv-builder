<script setup lang="ts">
import type { PropType } from 'vue';
import type { CvItem } from '../types';
import MarkdownContent from './MarkdownContent.vue';
import { hasMarkdownText } from '../composables/markdownText.ts';

defineProps({
  kind: { type: String, required: true },
  item: { type: Object as PropType<CvItem>, required: true },
  meta: { type: String, default: '' },
  anonymized: { type: Boolean, default: false },
  institution: { type: Boolean, default: false },
  showTitle: { type: Boolean, default: true },
  showDescription: { type: Boolean, default: true },
});
</script>

<template>
  <article class="item" :class="{ 'experience-item': kind === 'jobs', 'education-item': kind === 'education', 'custom-body-item': kind === 'custom', 'custom-body-item--with-institution': kind === 'custom' && institution }">
    <template v-if="kind === 'jobs'">
      <div v-if="item.company || meta" class="item-details">
        <div v-if="item.company" class="item-sub">{{ item.company }}</div>
        <div v-if="meta" class="item-meta">{{ meta }}</div>
      </div>
      <h3 class="item-title">{{ item.title }}</h3>
      <MarkdownContent :value="item.bullets" :anonymized="anonymized" />
    </template>
    <template v-else-if="kind === 'education'">
      <div v-if="item.sub || meta" class="item-details">
        <div v-if="item.sub" class="item-sub">{{ item.sub }}</div>
        <div v-if="meta" class="item-meta">{{ meta }}</div>
      </div>
      <h3 class="item-title">{{ item.title }}</h3>
      <div v-if="hasMarkdownText(item.thesis) || hasMarkdownText(item.coursesText)" class="education-details">
        <div v-if="hasMarkdownText(item.thesis)" class="education-thesis"><MarkdownContent :value="item.thesis" :anonymized="anonymized" /></div>
        <div v-if="hasMarkdownText(item.coursesText)" class="education-courses"><MarkdownContent :value="item.coursesText" :anonymized="anonymized" /></div>
      </div>
    </template>
    <template v-else>
      <div v-if="institution || meta" class="item-details">
        <div v-if="institution" class="item-sub">{{ item.institution }}</div>
        <div v-if="meta" class="item-meta">{{ meta }}</div>
      </div>
      <h3 v-if="showTitle" class="item-title">{{ item.title }}</h3>
      <MarkdownContent v-if="showDescription" :value="item.desc" :anonymized="anonymized" />
    </template>
  </article>
</template>
