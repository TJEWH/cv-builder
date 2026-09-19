<script setup lang="ts">
import { computed, defineComponent, h } from 'vue';
import type { PropType, VNode } from 'vue';
import { buildOpportunityGroups } from '../composables/opportunityContext';
import type { OpportunityContextNode } from '../composables/opportunityContext';

const props = defineProps<{ context: Record<string, unknown>; lang: string }>();
const groups = computed(() => buildOpportunityGroups(props.context, props.lang));

// Render recursive research structures as lists. Vue escapes every supplied text node.
const ContextValue = defineComponent({
  name: 'OpportunityContextValue',
  props: { node: { type: Object as PropType<OpportunityContextNode>, required: true } },
  setup(valueProps) {
    function renderValue(node: OpportunityContextNode): VNode {
      if (node.children) return h('ul', { class: 'opportunity-context__list' }, node.children.map((child) =>
        h('li', { key: child.id }, [child.label ? h('span', { class: 'opportunity-context__nested-label' }, `${child.label}: `) : null, renderValue(child)])));
      return node.href ? h('a', { href: node.href, ...(node.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, node.text)
        : h('span', { class: { 'opportunity-context__missing': node.missing } }, node.text);
    }
    return () => renderValue(valueProps.node);
  },
});
</script>

<template>
  <div class="opportunity-context">
    <section v-for="group in groups" :key="group.id" class="opportunity-context__group" :class="`opportunity-context__group--${group.id}`" :aria-label="group.label">
      <h3>{{ group.label }}</h3>
      <dl>
        <div v-for="item in group.items" :key="item.id" class="opportunity-context__field">
          <dt>{{ item.label }}</dt>
          <dd><ContextValue :node="item" /></dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.opportunity-context { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 16px; min-width: 0; color: #c8ded5; }
.opportunity-context__group { min-width: 0; padding: 17px 18px; border: 1px solid #21473f; border-radius: 9px; background: #0a2027; }
.opportunity-context__group--research { grid-column: 1 / -1; border-color: #376457; }
.opportunity-context__group--links { grid-column: 1 / -1; }
.opportunity-context__group h3 { margin: 0 0 15px; color: #9be8c7; font-size: 13px; letter-spacing: .2px; }
.opportunity-context__group dl { display: grid; gap: 15px; margin: 0; }
.opportunity-context__group--research dl, .opportunity-context__group--links dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.opportunity-context__field { min-width: 0; }
.opportunity-context__field dt { margin-bottom: 5px; color: #91b4a7; font-size: 11px; font-weight: 600; }
.opportunity-context__field dd { margin: 0; color: #d7e8df; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.opportunity-context :deep(.opportunity-context__list) { display: grid; gap: 8px; margin: 4px 0; padding-left: 18px; }
.opportunity-context :deep(.opportunity-context__list .opportunity-context__list) { margin-top: 3px; }
.opportunity-context :deep(.opportunity-context__nested-label) { color: #abc9bb; font-weight: 500; }
.opportunity-context :deep(.opportunity-context__missing) { color: #9bada7; font-style: italic; }
.opportunity-context :deep(a) { color: #9be8c7; text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.opportunity-context :deep(a:focus-visible) { outline: 2px solid #9be8c7; outline-offset: 3px; border-radius: 2px; }
@media (max-width: 760px) { .opportunity-context, .opportunity-context__group--research dl, .opportunity-context__group--links dl { grid-template-columns: minmax(0, 1fr); } .opportunity-context__group { padding: 15px; } }
</style>
