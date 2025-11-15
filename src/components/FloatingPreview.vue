<script setup>
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';

const props = defineProps({
  url: { type: String, default: '/preview.html' },
  // deutlich kleiner starten
  initialScale: { type: Number, default: 0.6 }
});

const iframeRef = ref(null);

// A4 @ ~96dpi (8.27in x 11.69in) – interne, „logische“ Größe
const base = { w: 794, h: 1123 };
const headerH = 42;

const pos = ref({ x: 24, y: 90 });
const scale = ref(props.initialScale);
const minScale = 0.4;
const maxScale = 1.2;

let dragging = false, startDrag = { x:0, y:0 }, origPos = { x:0, y:0 };
let resizing = false, startResize = { x:0, y:0, width:0, height:0, scale:0 };

const styleBox = computed(()=>({
  left: pos.value.x + 'px',
  top:  pos.value.y + 'px',
  width:  (base.w * scale.value) + 'px',
  height: (base.h * scale.value + headerH) + 'px'
}));
const styleInner = computed(()=>({
  width:  base.w + 'px',
  height: base.h + 'px',
  transform: `scale(${scale.value})`,
  transformOrigin: 'top left'
}));

function onMouseDown(e){
  // Header-drag
  dragging = true;
  startDrag = { x:e.clientX, y:e.clientY };
  origPos   = { ...pos.value };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function onMove(e){
  if(dragging){
    pos.value = { x: origPos.x + (e.clientX - startDrag.x),
      y: origPos.y + (e.clientY - startDrag.y) };
  } else if(resizing){
    // Resize über Ecke: striktes A4-Verhältnis
    const dx = e.clientX - startResize.x;
    const dy = e.clientY - startResize.y;

    // Wähle dominierende Achse, rechne andere über das Verhältnis um
    const ratio = base.w / base.h; // ~0.707
    const effDW = Math.abs(dx) > Math.abs(dy) * ratio ? dx : dy * ratio;

    const newWidth = Math.max(base.w*minScale, Math.min(base.w*maxScale, startResize.width + effDW));
    const newScale = newWidth / base.w;

    scale.value = +newScale.toFixed(3);
  }
}
function onUp(){
  dragging = false;
  resizing = false;
  document.removeEventListener('mousemove', onMove);
  document.removeEventListener('mouseup', onUp);
}

function onResizeDown(e){
  e.stopPropagation();
  resizing = true;
  startResize = {
    x: e.clientX,
    y: e.clientY,
    width:  base.w * scale.value,
    height: base.h * scale.value,
    scale:  scale.value
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function center(){
  // positioniert rechts (oben)
  const vw = window.innerWidth;
  const w  = base.w * scale.value;
  pos.value = { x: Math.max(12, vw - w - 24), y: Math.max(72, 72) };
}

function openPrint(){
  window.open('/preview.html#print', '_blank', 'noopener');
}

onMounted(()=> {
  center();
  window.addEventListener('resize', center);
});
onBeforeUnmount(()=> {
  window.removeEventListener('resize', center);
});

defineExpose({ openPrint });
</script>

<template>
  <div class="floating-preview" :style="styleBox">
    <div class="fp-head" @mousedown.stop.prevent="onMouseDown" title="Zum Verschieben ziehen">
      <strong>CV&nbsp;Preview</strong>
      <div class="spacer"></div>
      <button class="mini" @click="openPrint" title="Als PDF exportieren">Drucken</button>
    </div>
    <div class="fp-body">
      <iframe ref="iframeRef" :src="url" class="fp-iframe" :style="styleInner" />
      <!-- Resize-Handle (unten rechts) -->
      <div class="fp-resize" title="Größe ändern (A4-Verhältnis)" @mousedown.stop.prevent="onResizeDown"></div>
    </div>
  </div>
</template>

<style scoped>
.floating-preview{
  position: fixed;
  z-index: 999;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,.15);
  overflow: hidden;
  user-select: none;
}
.fp-head{
  height: 42px;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  background: #fff;
  cursor: grab;
}
.fp-head .spacer{ flex: 1 1 auto; }
.mini{
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
.fp-body{
  position: relative;
  padding: 0;
  overflow: hidden;
}
.fp-iframe{
  border: 0;
  background: transparent;
  display: block;
}

/* Resize-Griff unten rechts – se-resize Cursor, hält Verhältnis per JS */
.fp-resize{
  position: absolute;
  width: 16px;
  height: 16px;
  right: 4px;
  bottom: 4px;
  cursor: se-resize;
  border: 1px solid var(--border);
  border-radius: 3px;
  background:
      linear-gradient(135deg, transparent 0 50%, rgba(0,0,0,.08) 50% 100%),
      linear-gradient(135deg, rgba(0,0,0,.08) 0 0) bottom right / 8px 8px no-repeat,
      #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,.08) inset;
}
</style>
