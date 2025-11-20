<script setup>
import { computed, ref, watch, onMounted } from 'vue';

const props = defineProps({ modelValue: { type:Object, required:true } });
const emit  = defineEmits(['update:modelValue']);

const design = computed({
  get: ()=> props.modelValue,
  set: v  => emit('update:modelValue', v)
});

const bodyFonts = ['Inter','Source Sans 3','IBM Plex Sans','Work Sans','Nunito Sans','Rubik','Merriweather Sans','Hind'];
const headFonts = ['Inter','Montserrat','Poppins','Raleway','Space Grotesk','Playfair Display','Bitter','Merriweather'];
const hStyles   = ['clean','underline','leftbar','pill','stripe'];

const collapsed = ref(false);

function toggleCollapse() {
  collapsed.value = !collapsed.value;
}

function ensureFontLink(id, family){
  const elId = `gf-${id}`;
  let link = document.getElementById(elId);
  if(!family){ if(link) link.remove(); return; }
  const fam = family.replace(/\s+/g,'+');
  const href = `https://fonts.googleapis.com/css2?family=${fam}:wght@300;400;600;700&display=swap`;
  if(!link){ link = document.createElement('link'); link.id = elId; link.rel = 'stylesheet'; document.head.appendChild(link); }
  link.href = href;
}

const applyCSS = () => {
  const d = design.value;
  const root = document.documentElement.style;
  root.setProperty('--h1-size', d.h1);
  root.setProperty('--h2-size', d.h2);
  root.setProperty('--h3-size', d.h3);
  root.setProperty('--bullet-size', d.bullets);
  root.setProperty('--ink', d.ink);
  root.setProperty('--accent', d.accent);
  root.setProperty('--bg', d.bg);
  root.setProperty('--header-bg', d.headerbg);
  root.setProperty('--sidebar-bg', d.sidebarbg);
  ensureFontLink('body', d.fontBody);
  ensureFontLink('head', d.fontHead);
  root.setProperty('--font-body', `${d.fontBody ? `'${d.fontBody}', `:''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${d.fontHead ? `'${d.fontHead}', `:''}var(--font-body)`);
  document.documentElement.setAttribute('data-hstyle', d.hstyle || 'clean');
};

watch(design, applyCSS, { deep:true });
onMounted(applyCSS);

const palettes = [
  {name:'Indigo + Slate', ink:'#111827', accent:'#4f46e5', bg:'#ffffff', header:'#ffffff', sidebar:'#f8fafc'},
  {name:'Teal + Zinc',   ink:'#0f172a', accent:'#0f766e', bg:'#ffffff', header:'#ecfeff', sidebar:'#f0fdfa'},
  {name:'Purple + Gray', ink:'#1f2937', accent:'#6d28d9', bg:'#ffffff', header:'#f5f3ff', sidebar:'#faf5ff'},
  {name:'Blue + Offwhite', ink:'#111827', accent:'#0ea5e9', bg:'#fcfdff', header:'#eef6ff', sidebar:'#f5faff'}
];
const pick = (p)=>{ Object.assign(design.value, {ink:p.ink, accent:p.accent, bg:p.bg, headerbg:p.header, sidebarbg:p.sidebar}); };
</script>

<template>
  <section class="section-group" :class="{ collapsed: collapsed }">
    <div class="section-head">
      <button class="caret mini" type="button" @click="toggleCollapse">
        <font-awesome-icon :icon="['fas', 'palette']" class="section-icon" aria-hidden="true" />
      </button>
      <h3>Design</h3>
    </div>

    <div class="grid-3">
      <label>H1 Font Size
        <select v-model="design.h1"><option>18pt</option><option>22pt</option><option>24pt</option><option>26pt</option></select>
      </label>
      <label>H2 Font Size
        <select v-model="design.h2"><option>11pt</option><option>12pt</option><option>13pt</option><option>14pt</option></select>
      </label>
      <label>H3 Font Size
        <select v-model="design.h3"><option>9pt</option><option>10pt</option><option>11pt</option><option>12pt</option></select>
      </label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Bullet Point Font Size
        <select v-model="design.bullets"><option>9.5pt</option><option>10.5pt</option><option>11pt</option><option>12pt</option></select>
      </label>
      <label>Paragraph Font Color<input type="color" v-model="design.ink"></label>
      <label>Accent Color<input type="color" v-model="design.accent"></label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Page Background<input type="color" v-model="design.bg"></label>
      <label>Header Background<input type="color" v-model="design.headerbg"></label>
      <label>Sidebar Background<input type="color" v-model="design.sidebarbg"></label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Body-Font
        <select v-model="design.fontBody">
          <option :value="''">(System)</option>
          <option v-for="f in bodyFonts" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>
      <label>Headings-Font
        <select v-model="design.fontHead">
          <option :value="''">(wie Body)</option>
          <option v-for="f in headFonts" :key="f" :value="f">{{ f }}</option>
        </select>
      </label>
      <label>Heading-Style
        <select v-model="design.hstyle">
          <option v-for="s in hStyles" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
    </div>

    <div style="margin-top:6px">
      <label style="display:block;margin-bottom:4px">Templates:</label>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button v-for="p in palettes" :key="p.name" type="button" class="mini btn--primary" @click="pick(p)">
          <span :style="{display:'inline-block',width:'10px',height:'10px',background:p.accent,borderRadius:'50%',marginRight:'6px',verticalAlign:'-1px'}"></span>{{p.name}}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.section-group.collapsed > *:not(.section-head) {
  display: none;
}
.section-icon{ margin-right:8px; color:var(--muted); }
.caret{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:26px; padding:0; }
.caret .section-icon{ margin:0; }
</style>