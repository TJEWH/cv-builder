<script setup>
import { computed, watch, onMounted } from 'vue';

const props = defineProps({ modelValue: { type:Object, required:true } });
const emit  = defineEmits(['update:modelValue']);

const design = computed({
  get: ()=> props.modelValue,
  set: v  => emit('update:modelValue', v)
});

const bodyFonts = ['Inter','Source Sans 3','IBM Plex Sans','Work Sans','Nunito Sans','Rubik','Merriweather Sans','Hind'];
const headFonts = ['Inter','Montserrat','Poppins','Raleway','Space Grotesk','Playfair Display','Bitter','Merriweather'];
const hStyles   = ['clean','underline','leftbar','pill','stripe'];
const langs     = ['de','en'];

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
  root.setProperty('--radius', d.radius || '10px');
  root.setProperty('--header-radius', d.headerRadius || '12px');
  root.setProperty('--header-padY', (d.headerPadYmm||12) + 'mm');
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
  <section class="section-group">
    <div class="section-head">
      <button class="caret mini" type="button" @click="$el.parentElement.classList.toggle('collapsed')">▾</button>
      <h3>Design</h3>
    </div>

    <div class="grid-3">
      <label>Überschrift H1 Größe
        <select v-model="design.h1"><option>18pt</option><option>22pt</option><option>24pt</option><option>26pt</option></select>
      </label>
      <label>Section H2 Größe
        <select v-model="design.h2"><option>11pt</option><option>12pt</option><option>13pt</option><option>14pt</option></select>
      </label>
      <label>Unterüberschrift H3
        <select v-model="design.h3"><option>9pt</option><option>10pt</option><option>11pt</option><option>12pt</option></select>
      </label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Bulletgröße
        <select v-model="design.bullets"><option>9.5pt</option><option>10.5pt</option><option>11pt</option><option>12pt</option></select>
      </label>
      <label>Textfarbe <input type="color" v-model="design.ink"></label>
      <label>Akzentfarbe <input type="color" v-model="design.accent"></label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Seitenhintergrund <input type="color" v-model="design.bg"></label>
      <label>Header-Hintergrund <input type="color" v-model="design.headerbg"></label>
      <label>Sidebar-Hintergrund <input type="color" v-model="design.sidebarbg"></label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Eckenradius <input type="text" v-model="design.radius" placeholder="6px / 12px / 0.4rem"/></label>
      <label>Header-Radius <input type="text" v-model="design.headerRadius" placeholder="12px"/></label>
      <label>Header-Padding (mm) <input type="number" min="4" max="30" v-model.number="design.headerPadYmm"/></label>
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

    <div class="grid-3" style="margin-top:6px">
      <label>Sectionsprache
        <select v-model="design.lang">
          <option v-for="l in langs" :key="l" :value="l">{{ l==='de'?'Deutsch':'English' }}</option>
        </select>
      </label>
      <div></div><div></div>
    </div>

    <div style="margin-top:6px">
      <strong style="display:block;margin-bottom:4px">Vorschläge (passende Paletten):</strong>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        <button v-for="p in palettes" :key="p.name" type="button" class="mini btn--primary" @click="pick(p)">
          <span :style="{display:'inline-block',width:'10px',height:'10px',background:p.accent,borderRadius:'50%',marginRight:'6px',verticalAlign:'-1px'}"></span>{{p.name}}
        </button>
      </div>
    </div>
  </section>
</template>
