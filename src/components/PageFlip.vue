<script setup>
import { ref, onMounted, onBeforeUnmount, defineExpose } from 'vue';

const props = defineProps({
  isFlipped: { type: Boolean, default: false }
});

const emit = defineEmits(['update:isFlipped']);

const container = ref(null);
const flipped = ref(props.isFlipped);

const flip = () => {
  flipped.value = true;
  emit('update:isFlipped', true);
};

const unflip = () => {
  flipped.value = false;
  emit('update:isFlipped', false);
};

const toggle = () => {
  if (flipped.value) {
    unflip();
  } else {
    flip();
  }
};

defineExpose({ flip, unflip, toggle });

onMounted(() => {
  flipped.value = props.isFlipped;
});
</script>

<template>
  <div class="page-flip-container" ref="container">
    <div class="page-flip" :class="{ 'is-flipped': flipped }">
      <!-- Front: Form -->
      <div class="page-flip__front">
        <slot name="front"></slot>
      </div>
      
      <!-- Back: Preview -->
      <div class="page-flip__back">
        <slot name="back"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-flip-container {
  perspective: 2500px;
  width: 100%;
  min-height: 100vh;
}

.page-flip {
  position: relative;
  width: 100%;
  min-height: 100vh;
  transition: transform 1.2s cubic-bezier(0.645, 0.045, 0.355, 1);
  transform-style: preserve-3d;
}

.page-flip.is-flipped {
  transform: rotateY(-180deg);
}

.page-flip__front,
.page-flip__back {
  position: absolute;
  width: 100%;
  min-height: 100vh;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
}

.page-flip__front {
  transform: rotateY(0deg);
}

.page-flip__back {
  transform: rotateY(180deg);
  background: #0a0f14;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  box-sizing: border-box;
}

/* Smooth shadow during flip */
.page-flip::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, rgba(0,0,0,0.2) 0%, transparent 50%);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.6s ease;
}

.page-flip.is-flipped::after {
  opacity: 1;
}
</style>
