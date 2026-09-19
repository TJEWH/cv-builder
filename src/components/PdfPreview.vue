<script setup lang="ts">
import type { PropType } from 'vue';
import type { PreviewPage } from '../pdfTypes';
import { computed, onBeforeUnmount } from 'vue';
import { makeT } from '../i18n/dict.ts';

const props = defineProps({
  pages: { type: Array as PropType<PreviewPage[]>, default: () => [] },
  page: { type: Number, default: 1 },
  isUpdating: { type: Boolean, default: false },
  lang: { type: String, required: true },
  gestureNavigation: { type: Boolean, default: false },
});
const emit = defineEmits<{ 'update:page': [page: number] }>();

const langRef = computed(() => props.lang);
const t = makeT(langRef);
const totalPages = computed(() => props.pages.length);
const currentPage = computed(() => Math.min(Math.max(props.page, 1), Math.max(totalPages.value, 1)));
const currentPageData = computed(() => props.pages[currentPage.value - 1]?.svg || '');

const TRACKPAD_SWIPE_THRESHOLD = 72;
const TOUCH_SWIPE_THRESHOLD = 48;
let horizontalSwipeDistance = 0;
let horizontalSwipeReset: number | null = null;
let touchStart: { id: number; x: number; y: number } | null = null;

function turnPage(direction: number) {
  const nextPage = Math.min(Math.max(currentPage.value + direction, 1), totalPages.value);
  if (nextPage !== currentPage.value) emit('update:page', nextPage);
}

function resetTouchSwipe() {
  touchStart = null;
}

function handleTouchStart(event: TouchEvent) {
  resetTouchSwipe();
  if (!props.gestureNavigation || totalPages.value < 2 || event.touches.length !== 1) return;
  const touch = event.touches[0];
  touchStart = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
}

function isHorizontalTouchSwipe(touch: Touch) {
  if (!touchStart || touch.identifier !== touchStart.id) return false;
  const distanceX = Math.abs(touch.clientX - touchStart.x);
  const distanceY = Math.abs(touch.clientY - touchStart.y);
  return distanceX >= TOUCH_SWIPE_THRESHOLD && distanceX > distanceY * 1.25;
}

function handleTouchMove(event: TouchEvent) {
  if (!props.gestureNavigation || event.touches.length !== 1) {
    resetTouchSwipe();
    return;
  }
  if (isHorizontalTouchSwipe(event.touches[0]) && event.cancelable) event.preventDefault();
}

function handleTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (props.gestureNavigation && totalPages.value > 1 && event.touches.length === 0 && touch && isHorizontalTouchSwipe(touch)) {
    // Suppress the synthetic click so swiping across a PDF link never opens it.
    if (event.cancelable) event.preventDefault();
    turnPage(touch.clientX < touchStart!.x ? 1 : -1);
  }
  resetTouchSwipe();
}

function resetHorizontalSwipe() {
  horizontalSwipeDistance = 0;
  if (horizontalSwipeReset !== null) window.clearTimeout(horizontalSwipeReset);
  horizontalSwipeReset = null;
}

function handleTrackpadSlide(event: WheelEvent) {
  if (!props.gestureNavigation || totalPages.value < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
  // Trackpads report a two-finger horizontal slide as wheel input. Keep normal
  // vertical scrolling intact while using a deliberate horizontal slide to turn pages.
  event.preventDefault();
  horizontalSwipeDistance += event.deltaX;
  if (Math.abs(horizontalSwipeDistance) < TRACKPAD_SWIPE_THRESHOLD) {
    if (horizontalSwipeReset !== null) window.clearTimeout(horizontalSwipeReset);
    horizontalSwipeReset = window.setTimeout(resetHorizontalSwipe, 180);
    return;
  }

  const direction = Math.sign(horizontalSwipeDistance);
  resetHorizontalSwipe();
  turnPage(direction);
}

onBeforeUnmount(resetHorizontalSwipe);
</script>

<template>
  <section
    class="pdf-preview"
    :class="{ 'pdf-preview--gesture-navigation': gestureNavigation }"
    :aria-busy="isUpdating"
    @wheel="handleTrackpadSlide"
    @touchstart.passive="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="resetTouchSwipe"
  >
    <div class="pdf-preview__stage">
      <div
        v-if="currentPageData"
        class="pdf-preview__page"
        :aria-label="`${t('pdfPage')} ${currentPage}`"
        v-html="currentPageData"
      />
      <div v-else class="pdf-preview__empty" role="status">{{ t('previewLoading') }}</div>
      <div v-if="isUpdating" class="pdf-preview__status" role="status">
        {{ currentPageData ? t('previewUpdating') : t('previewLoading') }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.pdf-preview { width: 100%; min-width: 0; }
.pdf-preview--gesture-navigation { touch-action: pan-y pinch-zoom; }
.pdf-preview__stage { position: relative; display: grid; min-height: 220px; place-items: center; overflow: hidden; border-radius: 6px; background: #0b0f14; }
.pdf-preview__page { display: block; width: min(100%, 794px); height: auto; box-shadow: 0 5px 18px rgba(0, 0, 0, .4); }
.pdf-preview__page :deep(> svg) { display: block; width: 100%; height: auto; }
.pdf-preview__empty { color: #9be8c7; font-size: 13px; }
.pdf-preview__status { position: absolute; top: 8px; right: 8px; padding: 4px 7px; border: 1px solid #2a3441; border-radius: 6px; background: rgba(6, 16, 23, .9); color: #cbd5e1; font-size: 11px; }
</style>
