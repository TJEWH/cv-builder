<script setup>
import { computed, reactive } from 'vue';
import { makeT } from '../i18n/dict';

const props = defineProps({
  modelValue: { type: Object, required: true },
  lang: { type: String, default: 'de' },
});
const emit = defineEmits(['update:modelValue']);

const design = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});
const langRef = computed(() => props.lang || 'de');
const t = makeT(langRef);

const bodyFonts = ['Inter', 'Source Sans 3', 'IBM Plex Sans', 'Work Sans', 'Nunito Sans', 'Rubik', 'Merriweather Sans', 'Hind'];
const headFonts = ['Inter', 'Montserrat', 'Poppins', 'Raleway', 'Space Grotesk', 'Playfair Display', 'Bitter', 'Merriweather'];
const hStyles = ['clean', 'underline', 'leftbar', 'pill', 'stripe'];
const sections = reactive({
  typography: false,
  colors: false,
  backgrounds: false,
  spacing: false,
  badges: false,
  sidebar: false,
  layout: false,
});
const allCollapsed = computed(() => Object.values(sections).every(Boolean));
const bulkLabel = computed(() => allCollapsed.value ? t('expandAll') : t('collapseAll'));

function toggleAll() {
  const next = !allCollapsed.value;
  Object.keys(sections).forEach((key) => { sections[key] = next; });
}

const palettes = [
  { name: 'Indigo + Slate', ink: '#111827', accent: '#4f46e5', bg: '#ffffff', header: '#ffffff', sidebar: '#f8fafc' },
  { name: 'Teal + Zinc', ink: '#0f172a', accent: '#0f766e', bg: '#ffffff', header: '#ecfeff', sidebar: '#f0fdfa' },
  { name: 'Purple + Gray', ink: '#1f2937', accent: '#6d28d9', bg: '#ffffff', header: '#f5f3ff', sidebar: '#faf5ff' },
  { name: 'Blue + Offwhite', ink: '#111827', accent: '#0ea5e9', bg: '#fcfdff', header: '#eef6ff', sidebar: '#f5faff' },
];
function pick(palette) {
  design.value.ink = palette.ink;
  design.value.accent = palette.accent;
  design.value.bg = palette.bg;
  design.value.headerbg = palette.header;
  design.value.sidebarbg = palette.sidebar;
}
</script>

<template>
  <section class="section-group editor-panel design-panel">
    <div class="section-head editor-panel__header">
      <font-awesome-icon :icon="['fas', 'palette']" class="section-icon" aria-hidden="true" />
      <h3>{{ t('design') }}</h3>
      <button class="mini panel-bulk-toggle" type="button" :aria-label="bulkLabel" :title="bulkLabel" @click="toggleAll">
        <font-awesome-icon :icon="['fas', allCollapsed ? 'angles-down' : 'angles-up']" />
        {{ bulkLabel }}
      </button>
    </div>

    <div class="editor-panel__body">
      <section class="editor-subsection" :class="{ collapsed: sections.typography }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.typography = !sections.typography"><font-awesome-icon :icon="['fas', 'font']" /></button><h4>Typography</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3">
            <label>H1 Font Size: {{ design.h1 }}<input type="range" min="18" max="30" step="1" :value="parseInt(design.h1)" @input="design.h1 = $event.target.value + 'pt'"></label>
            <label>H2 Font Size: {{ design.h2 }}<input type="range" min="10" max="20" step="1" :value="parseInt(design.h2)" @input="design.h2 = $event.target.value + 'pt'"></label>
            <label>H3 Font Size: {{ design.h3 }}<input type="range" min="8" max="16" step="1" :value="parseInt(design.h3)" @input="design.h3 = $event.target.value + 'pt'"></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>Bullet Point Font Size: {{ design.bullets }}<input type="range" min="8" max="14" step="0.5" :value="parseFloat(design.bullets)" @input="design.bullets = $event.target.value + 'pt'"></label>
            <label>Bullet Point Style<select v-model="design.bulletStyle"><option value="disc">Disc (●)</option><option value="disclosure-closed">Disclosure (▸)</option><option value="circle">Circle (○)</option><option value="square">Square (■)</option></select></label>
          </div>
          <div class="grid-3 subsection-row">
            <label>Body-Font<select v-model="design.fontBody"><option :value="''">(System)</option><option v-for="font in bodyFonts" :key="font" :value="font">{{ font }}</option></select></label>
            <label>Headings-Font<select v-model="design.fontHead"><option :value="''">(wie Body)</option><option v-for="font in headFonts" :key="font" :value="font">{{ font }}</option></select></label>
          </div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.colors }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.colors = !sections.colors"><font-awesome-icon :icon="['fas', 'palette']" /></button><h4>Colors</h4></div>
        <div class="editor-subsection__body grid-3"><label>Paragraph Font Color<input type="color" v-model="design.ink"></label><label>Section Header Color<input type="color" v-model="design.accent"></label><label>Subtitle Color<input type="color" v-model="design.subtitle"></label><label>Graphic Color<input type="color" v-model="design.graphic"></label><label>Date Color<input type="color" v-model="design.dateColor"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.backgrounds }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.backgrounds = !sections.backgrounds"><font-awesome-icon :icon="['fas', 'image']" /></button><h4>Backgrounds</h4></div>
        <div class="editor-subsection__body grid-3"><label>Page Background<input type="color" v-model="design.bg"></label><label>Header Background<input type="color" v-model="design.headerbg"></label><label>Sidebar Background<input type="color" v-model="design.sidebarbg"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.spacing }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.spacing = !sections.spacing"><font-awesome-icon :icon="['fas', 'arrows-left-right-to-line']" /></button><h4>Spacing</h4></div>
        <div class="editor-subsection__body grid-3"><label>Body Section Spacing: {{ design.sectionSpacingBody || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingBody || design.sectionSpacing)" @input="design.sectionSpacingBody = $event.target.value + 'mm'"></label><label>Sidebar Section Spacing: {{ design.sectionSpacingSidebar || design.sectionSpacing }}<input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingSidebar || design.sectionSpacing)" @input="design.sectionSpacingSidebar = $event.target.value + 'mm'"></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.badges }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.badges = !sections.badges"><font-awesome-icon :icon="['fas', 'tag']" /></button><h4>Badges & Items</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3"><label>Border Width: {{ design.badgeBorderWidth || design.itemBorderWidth || '1px' }}<input type="range" min="0" max="4" step="0.5" :value="parseFloat(design.badgeBorderWidth || design.itemBorderWidth || '1')" @input="design.badgeBorderWidth = design.itemBorderWidth = $event.target.value + 'px'"></label><label>Badge Border Radius: {{ design.badgeBorderRadius }}<input type="range" min="0" max="20" step="1" :value="parseInt(design.badgeBorderRadius)" @input="design.badgeBorderRadius = $event.target.value + 'px'"></label></div>
          <div class="grid-3 subsection-row"><label class="checkbox-label"><input type="checkbox" v-model="design.invertBadge"><span>Invert Badge Colors</span></label><label class="checkbox-label"><input type="checkbox" v-model="design.enableBoxShadow"><span>Box Shadow Effects</span></label></div>
        </div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.sidebar }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.sidebar = !sections.sidebar"><font-awesome-icon :icon="['fas', 'table-columns']" /></button><h4>Sidebar Layout</h4></div>
        <div class="editor-subsection__body grid-3"><label>Sidebar Width: {{ design.sidebarWidth }}<input type="range" min="0.1" max="3.0" step="0.1" :value="parseFloat(design.sidebarWidth)" @input="design.sidebarWidth = $event.target.value + 'fr'"></label><label>Sidebar Position<select v-model="design.sidebarAlign"><option value="left">Links</option><option value="right">Rechts</option></select></label><label>Sidebar Style<select v-model="design.sidebarStyle"><option value="default">Standard (Padding + Radius)</option><option value="flush">Bündig (ohne Padding/Radius)</option><option value="edge">Kantenbündig (Padding außen)</option><option value="independent">Unabhängig</option></select></label></div>
      </section>

      <section class="editor-subsection" :class="{ collapsed: sections.layout }">
        <div class="section-head"><button class="caret mini" type="button" @click="sections.layout = !sections.layout"><font-awesome-icon :icon="['fas', 'table-cells-large']" /></button><h4>Layout</h4></div>
        <div class="editor-subsection__body">
          <div class="grid-3"><label>Add. Exp. Columns<select v-model="design.addExpColumns"><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label><label>Heading-Style<select v-model="design.hstyle"><option v-for="style in hStyles" :key="style" :value="style">{{ style }}</option></select></label></div>
          <div class="subsection-row"><label class="template-label">Templates:</label><div class="template-list"><button v-for="palette in palettes" :key="palette.name" type="button" class="mini btn--primary" @click="pick(palette)"><span :style="{ display: 'inline-block', width: '10px', height: '10px', background: palette.accent, borderRadius: '50%', marginRight: '6px', verticalAlign: '-1px' }"></span>{{ palette.name }}</button></div></div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.editor-subsection h4 { margin: 0; color: #9be8c7; font-size: 10pt; text-transform: uppercase; letter-spacing: .5px; }
.subsection-row { margin-top: 8px; }
.checkbox-label { display: flex; align-items: center; gap: 8px; }
.checkbox-label input { width: auto; margin: 0; }
.template-label { display: block; margin-bottom: 4px; }
.template-list { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
