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
  root.setProperty('--subtitle', d.subtitle || '#0a9c91');
  root.setProperty('--graphic', d.graphic || d.accent || '#4f46e5');
  root.setProperty('--date-color', d.dateColor || '#6b7280');
  root.setProperty('--badge-border-width', d.badgeBorderWidth || '1px');
  root.setProperty('--badge-border-radius', d.badgeBorderRadius || '6px');
  root.setProperty('--item-border-width', d.itemBorderWidth || '1px');
  root.setProperty('--section-spacing', d.sectionSpacing || '6mm');
  root.setProperty('--section-spacing-body', d.sectionSpacingBody || d.sectionSpacing || '6mm');
  root.setProperty('--section-spacing-sidebar', d.sectionSpacingSidebar || d.sectionSpacing || '6mm');
  root.setProperty('--sidebar-width', d.sidebarWidth || '0.7fr');
  root.setProperty('--sidebar-align', d.sidebarAlign || 'right');
  root.setProperty('--addexp-columns', d.addExpColumns || '2');
  root.setProperty('--bullet-size', d.bullets || '10.5pt');
  root.setProperty('--bullet-style', d.bulletStyle || 'disc');

  // Badge invert logic
  if (d.invertBadge) {
    root.setProperty('--badge-bg', 'transparent');
    root.setProperty('--badge-color', d.graphic || d.accent || '#4f46e5');
  } else {
    root.setProperty('--badge-bg', d.graphic || d.accent || '#4f46e5');
    root.setProperty('--badge-color', '#ffffff');
  }

  // Box shadow logic
  if (d.enableBoxShadow) {
    root.setProperty('--box-shadow', '0 2px 8px rgba(0,0,0,0.1)');
  } else {
    root.setProperty('--box-shadow', 'none');
  }

  ensureFontLink('body', d.fontBody);
  ensureFontLink('head', d.fontHead);
  root.setProperty('--font-body', `${d.fontBody ? `'${d.fontBody}', `:''}ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`);
  root.setProperty('--font-head', `${d.fontHead ? `'${d.fontHead}', `:''}var(--font-body)`);
  document.documentElement.setAttribute('data-hstyle', d.hstyle || 'clean');
  document.documentElement.setAttribute('data-sidebar-align', d.sidebarAlign || 'right');
  document.documentElement.setAttribute('data-sidebar-style', d.sidebarStyle || 'default');
};

watch(design, applyCSS, { deep:true });
onMounted(applyCSS);

const palettes = [
  {name:'Indigo + Slate', ink:'#111827', accent:'#4f46e5', bg:'#ffffff', header:'#ffffff', sidebar:'#f8fafc'},
  {name:'Teal + Zinc',   ink:'#0f172a', accent:'#0f766e', bg:'#ffffff', header:'#ecfeff', sidebar:'#f0fdfa'},
  {name:'Purple + Gray', ink:'#1f2937', accent:'#6d28d9', bg:'#ffffff', header:'#f5f3ff', sidebar:'#faf5ff'},
  {name:'Blue + Offwhite', ink:'#111827', accent:'#0ea5e9', bg:'#fcfdff', header:'#eef6ff', sidebar:'#f5faff'}
];
const pick = (p)=>{
  design.value.ink = p.ink;
  design.value.accent = p.accent;
  design.value.bg = p.bg;
  design.value.headerbg = p.header;
  design.value.sidebarbg = p.sidebar;
};
</script>

<template>
  <section class="section-group" :class="{ collapsed: collapsed }">
    <div class="section-head">
      <button class="caret mini" type="button" @click="toggleCollapse">
        <font-awesome-icon :icon="['fas', 'palette']" class="section-icon" aria-hidden="true" />
      </button>
      <h3>Design</h3>
    </div>

    <!-- Typography -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Typography</h4>

    <div class="grid-3">
      <label>H1 Font Size: {{ design.h1 }}
        <input type="range" min="18" max="30" step="1" :value="parseInt(design.h1)" @input="design.h1 = $event.target.value + 'pt'">
      </label>
      <label>H2 Font Size: {{ design.h2 }}
        <input type="range" min="10" max="20" step="1" :value="parseInt(design.h2)" @input="design.h2 = $event.target.value + 'pt'">
      </label>
      <label>H3 Font Size: {{ design.h3 }}
        <input type="range" min="8" max="16" step="1" :value="parseInt(design.h3)" @input="design.h3 = $event.target.value + 'pt'">
      </label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label>Bullet Point Font Size: {{ design.bullets }}
        <input type="range" min="8" max="14" step="0.5" :value="parseFloat(design.bullets)" @input="design.bullets = $event.target.value + 'pt'">
      </label>
      <label>Bullet Point Style
        <select v-model="design.bulletStyle">
          <option value="disc">Disc (●)</option>
          <option value="disclosure-closed">Disclosure (▸)</option>
          <option value="circle">Circle (○)</option>
          <option value="square">Square (■)</option>
        </select>
      </label>
      <label></label>
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
      <label></label>
    </div>

    <!-- Colors -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Colors</h4>

    <div class="grid-3">
      <label>Paragraph Font Color<input type="color" v-model="design.ink"></label>
      <label>Section Header Color<input type="color" v-model="design.accent"></label>
      <label>Subtitle Color<input type="color" v-model="design.subtitle"></label>
    </div>

    <div class="grid-3">
      <label>Graphic Color<input type="color" v-model="design.graphic"></label>
      <label>Date Color<input type="color" v-model="design.dateColor"></label>
      <label></label>
    </div>

    <!-- Backgrounds -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Backgrounds</h4>

    <div class="grid-3">
      <label>Page Background<input type="color" v-model="design.bg"></label>
      <label>Header Background<input type="color" v-model="design.headerbg"></label>
      <label>Sidebar Background<input type="color" v-model="design.sidebarbg"></label>
    </div>

    <!-- Spacing -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Spacing</h4>

    <div class="grid-3">
      <label>Body Section Spacing: {{ design.sectionSpacingBody || design.sectionSpacing }}
        <input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingBody || design.sectionSpacing)" @input="design.sectionSpacingBody = $event.target.value + 'mm'">
      </label>
      <label>Sidebar Section Spacing: {{ design.sectionSpacingSidebar || design.sectionSpacing }}
        <input type="range" min="2" max="20" step="1" :value="parseInt(design.sectionSpacingSidebar || design.sectionSpacing)" @input="design.sectionSpacingSidebar = $event.target.value + 'mm'">
      </label>
      <label></label>
    </div>

    <!-- Badges & Items -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Badges & Items</h4>

    <div class="grid-3">
      <label>Border Width: {{ design.badgeBorderWidth || design.itemBorderWidth || '1px' }}
        <input type="range" min="0" max="4" step="0.5" :value="parseFloat(design.badgeBorderWidth || design.itemBorderWidth || '1')" @input="design.badgeBorderWidth = design.itemBorderWidth = $event.target.value + 'px'">
      </label>
      <label>Badge Border Radius: {{ design.badgeBorderRadius }}
        <input type="range" min="0" max="20" step="1" :value="parseInt(design.badgeBorderRadius)" @input="design.badgeBorderRadius = $event.target.value + 'px'">
      </label>
      <label></label>
    </div>

    <div class="grid-3" style="margin-top:6px">
      <label style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" v-model="design.invertBadge" style="width:auto;margin:0">
        <span>Invert Badge Colors</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" v-model="design.enableBoxShadow" style="width:auto;margin:0">
        <span>Box Shadow Effects</span>
      </label>
      <label></label>
    </div>

    <!-- Sidebar Layout -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Sidebar Layout</h4>

    <div class="grid-3">
      <label>Sidebar Width: {{ design.sidebarWidth }}
        <input type="range" min="0.1" max="3.0" step="0.1" :value="parseFloat(design.sidebarWidth)" @input="design.sidebarWidth = $event.target.value + 'fr'">
      </label>
      <label>Sidebar Position
        <select v-model="design.sidebarAlign">
          <option value="left">Links</option>
          <option value="right">Rechts</option>
        </select>
      </label>
      <label>Sidebar Style
        <select v-model="design.sidebarStyle">
          <option value="default">Standard (Padding + Radius)</option>
          <option value="flush">Bündig (ohne Padding/Radius)</option>
          <option value="edge">Kantenbündig (Padding außen)</option>
          <option value="independent">Unabhängig</option>
        </select>
      </label>
    </div>

    <!-- Layout -->
    <h4 style="margin:12px 0 6px;color:#9be8c7;font-size:10pt;text-transform:uppercase;letter-spacing:0.5px">Layout</h4>

    <div class="grid-3">
      <label>Add. Exp. Columns
        <select v-model="design.addExpColumns">
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </label>
      <label>Heading-Style
        <select v-model="design.hstyle">
          <option v-for="s in hStyles" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>
      <label></label>
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
.section-group.collapsed {width: 100%;}
.section-group.collapsed > *:not(.section-head) {
  display: none;
}
.section-icon{ margin-right:8px; color:var(--muted); }
.caret{ display:inline-flex; align-items:center; justify-content:center; width:34px; height:26px; padding:0; }
.caret .section-icon{ margin:0; }
</style>