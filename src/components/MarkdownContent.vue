<script setup>
import { computed } from 'vue';
import { parseInlineMarkdown, parseMarkdownText, renderConfidentialText } from '../composables/markdownText.js';

const props = defineProps({
  value: { type: [String, Array], default: '' },
  anonymized: { type: Boolean, default: false },
});

const content = computed(() => {
  const parsed = parseMarkdownText(renderConfidentialText(props.value, { anonymized: props.anonymized }));
  return {
    prose: parseInlineMarkdown(parsed.prose),
    bullets: parsed.bullets.map((bullet) => parseInlineMarkdown(bullet)),
  };
});
</script>

<template>
  <p v-if="content.prose.length" class="markdown-content__prose">
    <template v-for="(token, index) in content.prose" :key="index">
      <strong v-if="token.type === 'bold'">{{ token.value }}</strong>
      <s v-else-if="token.type === 'strike'">{{ token.value }}</s>
      <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.value }}</a>
      <template v-else>{{ token.value }}</template>
    </template>
  </p>
  <ul v-if="content.bullets.length" class="markdown-bullets">
    <li v-for="(bullet, bulletIndex) in content.bullets" :key="bulletIndex">
      <template v-for="(token, tokenIndex) in bullet" :key="tokenIndex">
        <strong v-if="token.type === 'bold'">{{ token.value }}</strong>
        <s v-else-if="token.type === 'strike'">{{ token.value }}</s>
        <a v-else-if="token.type === 'link'" :href="token.href" target="_blank" rel="noopener noreferrer">{{ token.value }}</a>
        <template v-else>{{ token.value }}</template>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.markdown-content__prose { margin: 1.5mm 0 0 }
.markdown-bullets li { white-space: pre-line; }
.markdown-content__prose a,
.markdown-bullets a {
  color: inherit;
  /* html2canvas does not reliably apply text-underline-offset. A border
     keeps the link rule below its glyphs in the PDF. */
  padding-bottom: 0;
  border-bottom: 1px solid currentColor;
  text-decoration: none;
}
</style>
