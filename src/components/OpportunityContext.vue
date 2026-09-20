<script setup lang="ts">
import { computed, defineComponent, h, useId } from 'vue';
import type { PropType, VNode } from 'vue';
import { buildOpportunityGroups, checklistKeys } from '../composables/opportunityContext';
import type { OpportunityContextNode } from '../composables/opportunityContext';

const props = defineProps<{ context: Record<string, unknown>; lang: string; checklist?: boolean; completedKeys?: string[]; saving?: boolean }>();
const emit = defineEmits<{ toggleChecklist: [key: string, completed: boolean] }>();
const groups = computed(() => buildOpportunityGroups(props.context, props.lang));
const completed = computed(() => new Set(props.completedKeys || []));
function progress(nodes: OpportunityContextNode[]) {
  const keys = checklistKeys(nodes);
  return keys.length ? `${keys.filter((key) => completed.value.has(key)).length} / ${keys.length} ${props.lang === 'de' ? 'erledigt' : 'done'}` : '';
}

// Render recursive research structures as lists. Vue escapes every supplied text node.
const ContextValue = defineComponent({
  name: 'OpportunityContextValue',
  props: { node: { type: Object as PropType<OpportunityContextNode>, required: true } },
  setup(valueProps) {
    const inputPrefix = useId();
    function renderValue(node: OpportunityContextNode, withCheckbox = true, labelFor?: string, includeLabel = false): VNode {
      if (props.checklist && withCheckbox && node.checklistKey) {
        const key = node.checklistKey;
        const checked = completed.value.has(key);
        const inputId = `${inputPrefix}-checklist-${encodeURIComponent(node.id)}`;
        const checkboxLabel = includeLabel && node.label ? node.label : node.href && !node.children?.length
          ? props.lang === 'de' ? 'Als erledigt markieren' : 'Mark complete' : null;
        return h('div', { class: ['opportunity-context__checklist-item', { 'is-complete': checked }] }, [
          h('input', { id: inputId, type: 'checkbox', checked, disabled: props.saving,
            'aria-label': [node.label, node.text].filter(Boolean).join(': ') || node.children?.map((child) => child.text || child.label).filter(Boolean).join('; '),
            onChange: (event: Event) => {
              const target = event.target as HTMLInputElement;
              const next = target.checked;
              target.checked = checked;
              emit('toggleChecklist', key, next);
            } }),
          h('div', [checkboxLabel ? h('label', { for: inputId, class: 'opportunity-context__checklist-label opportunity-context__nested-label' }, `${checkboxLabel}: `) : null, renderValue(node, false, inputId)]),
        ]);
      }
      const value = node.href ? h('a', { href: node.href, ...(node.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {}) }, node.text)
        : h(labelFor ? 'label' : 'span', { ...(labelFor ? { for: labelFor } : {}), class: { 'opportunity-context__checklist-label': !!labelFor, 'opportunity-context__missing': node.missing } }, node.text);
      const children = node.children?.length ? h('ul', { class: 'opportunity-context__list' }, node.children.map((child) => {
        const checklistChild = !!(props.checklist && !labelFor && child.checklistKey);
        return h('li', { key: child.id }, [child.label && !checklistChild ? h(labelFor ? 'label' : 'span', { ...(labelFor ? { for: labelFor } : {}), class: ['opportunity-context__nested-label', { 'opportunity-context__checklist-label': !!labelFor }] }, `${child.label}: `) : null, renderValue(child, !labelFor, labelFor, checklistChild)]);
      })) : null;
      if (node.kind === 'fit') {
        const score = node.score;
        return h('div', [score !== undefined ? h('div', { class: 'opportunity-context__score' }, [
          h('strong', { class: 'opportunity-context__score-number' }, node.text),
          h('div', { class: 'opportunity-context__score-track', role: 'meter', 'aria-label': node.label,
            'aria-valuemin': 0, 'aria-valuemax': 10, 'aria-valuenow': score, 'aria-valuetext': node.text },
          h('span', { class: 'opportunity-context__score-fill', style: { width: `${score * 10}%` }, 'aria-hidden': 'true' })),
        ]) : h('span', { class: 'opportunity-context__missing' }, props.lang === 'de' ? 'Keine Bewertung auf der Skala 0–10' : 'No score on the 0–10 scale'),
        score === undefined && node.text ? value : null, children]);
      }
      if (!children) return value;
      return h('div', [node.text ? value : null, children]);
    }
    return () => renderValue(valueProps.node);
  },
});
</script>

<template>
  <div class="opportunity-context">
    <details v-for="group in groups" :key="group.id" class="opportunity-context__group" :class="`opportunity-context__group--${group.id}`" :open="['overview', 'salary', 'requirements', 'documents'].includes(group.id)">
      <summary>{{ group.label }} <span v-if="checklist && ['requirements', 'documents'].includes(group.id)" class="opportunity-context__progress">{{ progress(group.items) }}</span></summary>
      <dl>
        <div v-for="item in group.items" :key="item.id" class="opportunity-context__field" :class="item.kind ? `opportunity-context__field--${item.kind}` : undefined">
          <dt>{{ item.label }}</dt>
          <dd><ContextValue :node="item" /></dd>
        </div>
      </dl>
    </details>
  </div>
</template>

<style scoped>
.opportunity-context { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; min-width: 0; color: #c8ded5; }
.opportunity-context__group { min-width: 0; padding: 17px 18px; border: 1px solid #21473f; border-radius: 9px; background: #0a2027; }
.opportunity-context__group--advisor { border-color: #376457; }
.opportunity-context__group--overview { border-color: #376457; }
.opportunity-context__group summary { color: #9be8c7; font-size: 13px; font-weight: 600; letter-spacing: .2px; cursor: pointer; }
.opportunity-context__group summary:focus-visible { outline: 2px solid #9be8c7; outline-offset: 5px; border-radius: 2px; }
.opportunity-context__group[open] > summary { margin-bottom: 18px; }
.opportunity-context__group dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 24px; margin: 0; }
.opportunity-context__group--overview dl { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.opportunity-context__field { min-width: 0; }
.opportunity-context__field--summary, .opportunity-context__field--main-link { grid-column: 1 / -1; }
.opportunity-context__field--fit { padding: 15px; border: 1px solid #2a5046; border-radius: 8px; background: #102b30; }
.opportunity-context__field dt { margin-bottom: 5px; color: #91b4a7; font-size: 11px; font-weight: 600; }
.opportunity-context__field dd { margin: 0; color: #d7e8df; font-size: 12px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.opportunity-context__progress { margin-left: 12px; font-size: 11px; font-weight: 400; color: #a7c8ba; }
.opportunity-context :deep(.opportunity-context__checklist-item) { display: flex; align-items: flex-start; gap: 10px; }
.opportunity-context :deep(.opportunity-context__checklist-item > input[type=checkbox]) { flex: 0 0 16px; width: 16px; height: 16px; padding: 0; margin: 2px 0 0; accent-color: #65d8ac; cursor: pointer; }
.opportunity-context :deep(.opportunity-context__checklist-item > div) { flex: 1; min-width: 0; }
.opportunity-context :deep(.opportunity-context__checklist-label) { display: inline; font: inherit; color: inherit; cursor: pointer; }
.opportunity-context :deep(.opportunity-context__checklist-item > input:disabled + div label) { cursor: wait; }
.opportunity-context :deep(ul:has(> li > .opportunity-context__checklist-item)) { padding-left: 0; list-style: none; }
.opportunity-context :deep(.opportunity-context__checklist-item.is-complete > div) { color: #9bbaad; }
.opportunity-context :deep(.opportunity-context__list) { display: grid; gap: 8px; margin: 4px 0; padding-left: 18px; }
.opportunity-context :deep(.opportunity-context__list .opportunity-context__list) { margin-top: 3px; }
.opportunity-context :deep(.opportunity-context__nested-label) { color: #abc9bb; font-weight: 500; }
.opportunity-context :deep(.opportunity-context__missing) { color: #9bada7; font-style: italic; }
.opportunity-context :deep(.opportunity-context__score) { display: grid; gap: 8px; margin: 5px 0 16px; }
.opportunity-context :deep(.opportunity-context__score-number) { color: #b7f3d9; font-size: 23px; font-variant-numeric: tabular-nums; line-height: 1.2; }
.opportunity-context :deep(.opportunity-context__score-track) { height: 10px; overflow: hidden; border-radius: 5px; background: #071b20; border: 1px solid #3c6256; }
.opportunity-context :deep(.opportunity-context__score-fill) { display: block; height: 100%; background: #65d8ac; border-radius: inherit; }
.opportunity-context :deep(a) { color: #9be8c7; text-decoration: underline; text-underline-offset: 3px; overflow-wrap: anywhere; }
.opportunity-context :deep(a:focus-visible) { outline: 2px solid #9be8c7; outline-offset: 3px; border-radius: 2px; }
@media (max-width: 760px) { .opportunity-context__group dl { grid-template-columns: minmax(0, 1fr); } .opportunity-context__group { padding: 15px; } }
</style>
