<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string;
  busy: boolean;
  canCopy: boolean;
  canLoad: boolean;
  fallbackPrompt: string;
  lang: string;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  copy: [];
  load: [];
}>();
const maxLength = 2_097_152;
const text = (en: string, de: string) => props.lang === 'de' ? de : en;
const copyDisabled = computed(() => props.busy || !props.canCopy);
const loadDisabled = computed(() => props.busy || !props.canLoad || !props.modelValue.trim() || props.modelValue.length > maxLength);
const copy = () => { if (!copyDisabled.value) emit('copy'); };
const load = () => { if (!loadDisabled.value) emit('load'); };
</script>

<template>
  <details class="disclosure-row manual-exchange">
    <summary>{{ text('Copy & paste with ChatGPT', 'Kopieren & Einfügen mit ChatGPT') }}</summary>
    <p class="app-hint">{{ text('If ChatGPT cannot access the connected tools, copy the full prompt into ChatGPT and paste its JSON response below.', 'Wenn ChatGPT nicht auf die verbundenen Werkzeuge zugreifen kann, den vollständigen Prompt in ChatGPT einfügen und die JSON-Antwort unten einsetzen.') }}</p>
    <button type="button" :disabled="copyDisabled" @click="copy">{{ text('Copy full prompt with sources', 'Vollständigen Prompt mit Quellen kopieren') }}</button>
    <label v-if="fallbackPrompt">
      {{ text('Full prompt with sources', 'Vollständiger Prompt mit Quellen') }}
      <textarea :value="fallbackPrompt" readonly rows="6" @focus="($event.target as HTMLTextAreaElement).select()" />
    </label>
    <label>
      {{ text('Proposal response', 'Vorschlagsantwort') }}
      <textarea :value="modelValue" :disabled="busy || !canLoad" :maxlength="maxLength" rows="6" spellcheck="false" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    </label>
    <p class="app-hint">{{ text('Loading the proposal updates the working document automatically.', 'Beim Laden des Vorschlags wird das Arbeitsdokument automatisch aktualisiert.') }}</p>
    <button type="button" :disabled="loadDisabled" @click="load">{{ text('Load pasted proposal', 'Eingefügten Vorschlag laden') }}</button>
  </details>
</template>

<style scoped>
.manual-exchange{font-size:13px;line-height:1.5}
p{margin:0 0 12px}
label{display:grid;gap:8px;margin:12px 0}
button,textarea{color:inherit;background:#0b1b25;border:1px solid #28534e;border-radius:6px;padding:8px;font:inherit}
button{cursor:pointer}
button:disabled,textarea:disabled{opacity:.5}
textarea{box-sizing:border-box;width:100%;min-width:0;resize:vertical;font-family:monospace}
@media(max-width:600px){textarea{font-size:16px}}
</style>
