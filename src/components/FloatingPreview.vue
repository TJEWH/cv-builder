<script setup>
import { ref, computed, onMounted, onBeforeUnmount, defineExpose } from 'vue';

const props = defineProps({
  url: { type: String, required: true },
  initialScale: { type: Number, default: 0.45 },
  minScale: { type: Number, default: 0.25 },
  maxScale: { type: Number, default: 1.2 }
});

// A4 bei ~96dpi
const BASE_W = 794;
const BASE_H = 1123;

const scale = ref(props.initialScale);
const scaledW = computed(() => Math.round(BASE_W * scale.value));
const scaledH = computed(() => Math.round(BASE_H * scale.value));

const pos = ref({ x: 24, y: 24 });
const dragging = ref(false);
let dragStart = null;

const startDrag = (e) => {
  dragging.value = true;
  dragStart = { mx: e.clientX, my: e.clientY, x0: pos.value.x, y0: pos.value.y };
  window.addEventListener('mousemove', onDragMove, true);
  window.addEventListener('mouseup', endDrag, true);
};
const onDragMove = (e) => {
  if (!dragging.value) return;
  const dx = e.clientX - dragStart.mx;
  const dy = e.clientY - dragStart.my;
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = scaledW.value + 2;
  //const h = scaledH.value + 36;
  pos.value.x = Math.min(Math.max(dragStart.x0 + dx, -w + margin), vw - margin);
  pos.value.y = Math.min(Math.max(dragStart.y0 + dy, -margin), vh - margin);
};
const endDrag = () => {
  dragging.value = false;
  window.removeEventListener('mousemove', onDragMove, true);
  window.removeEventListener('mouseup', endDrag, true);
};

// === Robust Resize ===
const resizing = ref(false);
let rzStart = null;
// Fullscreen-Overlay blockt iFrame-Events während des Resizes
const showOverlay = () => {
  const el = document.createElement('div');
  el.className = 'fp-global-overlay';
  document.body.appendChild(el);
};
const hideOverlay = () => {
  document.querySelectorAll('.fp-global-overlay').forEach(n => n.remove());
};

const startResize = (e) => {
  e.preventDefault(); e.stopPropagation();
  resizing.value = true;              // <-- toggles class
  showOverlay();
  try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch {}
  rzStart = {
    mx: e.clientX,
    my: e.clientY,
    w0: scaledW.value,
    h0: scaledH.value,
    scale0: scale.value
  };
  window.addEventListener('mousemove', onResizeMove, true);
  window.addEventListener('mouseup', endResize, true);
  window.addEventListener('blur', endResize, true);
};

const onResizeMove = (e) => {
  if (!resizing.value) return;
  const dx = e.clientX - rzStart.mx;
  const targetW = Math.max(160, rzStart.w0 + dx);
  const nextScale = targetW / BASE_W;
  scale.value = Math.min(props.maxScale, Math.max(props.minScale, nextScale));
};

const endResize = () => {
  if (!resizing.value) return;
  resizing.value = false;             // <-- remove class
  hideOverlay();
  window.removeEventListener('mousemove', onResizeMove, true);
  window.removeEventListener('mouseup', endResize, true);
  window.removeEventListener('blur', endResize, true);
};

const frame = ref(null);
const openPrint = () => {
  try { frame.value?.contentWindow?.focus(); frame.value?.contentWindow?.print(); } catch {}
};
defineExpose({ openPrint });

onMounted(() => {
  const onEsc = (e) => {
    if (e.key === 'Escape') { dragging.value = false; endResize(); }
  };
  window.addEventListener('keydown', onEsc);
  onBeforeUnmount(() => window.removeEventListener('keydown', onEsc));
});
</script>

<template>
  <div class="floating-preview" :class="{ 'is-resizing': resizing }"
      :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
      @mousedown.stop>

    <div class="fp-header" @mousedown="startDrag">
      <strong>Preview (A4)</strong>
      <span class="fp-size">{{ Math.round(scale*100) }}%</span>
      <div class="fp-actions">
        <button class="mini" type="button" @click="openPrint">Export</button>
      </div>
    </div>

  <div
      class="fp-body"
      :class="{ 'is-resizing': resizing }"
  :style="{ width: scaledW + 'px', height: scaledH + 'px' }"
  >
    <iframe
        ref="frame"
        class="fp-iframe"
        :src="url"
        :style="{
            width: BASE_W + 'px',
            height: BASE_H + 'px',
            transform: 'scale(' + scale + ')',
            transformOrigin: 'top left'
          }"
    ></iframe>

    <div class="fp-resizer" title="Resize (DIN A4)"
         @mousedown="startResize"
         @pointerdown="startResize"></div>
  </div>
  </div>
</template>

<style scoped>
.floating-preview{
  position: fixed;
  z-index: 9999;
  user-select: none;
  border: 1px solid #2a3441;
  border-radius: 10px;
  background: #0a0f14;
  box-shadow: 0 12px 28px rgba(0,0,0,.45);
  backdrop-filter: blur(2px);
}

/* YELLOW highlight while resizing */
.floating-preview.is-resizing{
  border-color: #f59e0b; /* amber-500 */
  box-shadow:
      0 0 0 2px #f59e0b inset,        /* inner yellow ring */
      0 12px 28px rgba(0,0,0,.45);     /* keep drop shadow */
}
.fp-body.is-resizing{
  outline: 2px dashed #f59e0b;
  outline-offset: -2px;
}

.fp-header{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:8px 10px; cursor:move; border-bottom:1px dashed #113c34;
  color:#9be8c7; background:#061017; border-radius: 10px 10px 0 0;
}
.fp-size{font-size:12px;color:#78d1b8}
.fp-actions .mini{ padding:4px 7px; border:1px dashed #134e4a; border-radius:6px; background:#061017; color:#9be8c7; cursor:pointer }
.fp-actions .mini:hover{ background:#0a1c26 }

.fp-body{ position: relative; overflow: hidden; background:#0b0f14; border-radius: 0 0 10px 10px }
.fp-iframe{ display:block; border:0 }

.fp-resizer{
  position:absolute; right:4px; bottom:4px; width:16px; height:16px;
  cursor:nwse-resize; border-right:2px solid #0f766e; border-bottom:2px solid #0f766e; border-radius:7px; opacity:.9;
}
.floating-preview.is-resizing .fp-resizer{
  border-right-color:#f59e0b; border-bottom-color:#f59e0b;
}
.fp-resizer::before{
  content:"";
  position:absolute;
  right: 2px;
  bottom: 2px;
  width: 7px;
  height: 7px;
  border-right: 2px solid #0f766e;
  border-bottom: 2px solid #0f766e;
  border-radius: 4px;
  opacity:.9;
}

/* Fullscreen-Overlay: blockt iFrame-MouseEvents während Resizes */
</style>

<!-- unscoped for the overlay -->
<style>
.fp-global-overlay{
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: transparent;
  cursor: nwse-resize;
}
</style>
