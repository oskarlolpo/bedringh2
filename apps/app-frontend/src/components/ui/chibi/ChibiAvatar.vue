<template>
  <div
    class="chibi-avatar-wrapper"
    :class="{ 'has-pointer': enableHurtOnClick, 'is-mirrored': mirror }"
    style="background: transparent !important; border: none !important; outline: none !important; box-shadow: none !important;"
    @click="handleCanvasClick"
  >
    <canvas
      ref="canvasRef"
      :width="width"
      :height="height"
      class="chibi-canvas"
      style="background: transparent !important; border: none !important; outline: none !important; box-shadow: none !important;"
    ></canvas>
    <div v-if="loading" class="chibi-loading-spinner"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';

import { ChibiLauncherRenderer } from './chibi-skin-renderer';

const props = withDefaults(
  defineProps<{
    skinUrl: string;              // URL, base64 data URI, or path to Minecraft skin PNG
    width?: number;                // Canvas resolution width (default: 256)
    height?: number;               // Canvas resolution height (default: 256)
    pose?: string;                 // Pose (default: 'sit' / 'sitting')
    facing?: string;               // Angle (default: '34-left')
    mirror?: boolean;              // Mirror / flip horizontally
    enableHurtOnClick?: boolean;   // Trigger MC damage animation on click
  }>(),
  {
    width: 256,
    height: 256,
    pose: 'sit',
    facing: '34-left',
    mirror: false,
    enableHurtOnClick: true,
  }
);

const emit = defineEmits<{
  (e: 'loaded', info: { model: string; isSlim: boolean }): void;
  (e: 'error', error: any): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const loading = ref(false);
let renderer: ChibiLauncherRenderer | null = null;

const loadAvatar = async () => {
  if (!canvasRef.value || !props.skinUrl) return;
  loading.value = true;
  try {
    renderer = new ChibiLauncherRenderer(canvasRef.value, {
      pose: props.pose,
      facing: props.facing,
      bgTransparent: true,
    });
    const info = await renderer.loadSkin(props.skinUrl);
    emit('loaded', info);
  } catch (err) {
    emit('error', err);
  } finally {
    loading.value = false;
  }
};

const handleCanvasClick = (e: MouseEvent) => {
  if (props.enableHurtOnClick && renderer) {
    renderer.triggerHurt(e.clientX, e.clientY);
  }
};

onMounted(() => {
  loadAvatar();
});

watch(
  () => [props.skinUrl, props.pose, props.facing],
  () => {
    loadAvatar();
  }
);
</script>

<style scoped>
.chibi-avatar-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  user-select: none;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}

.chibi-avatar-wrapper.has-pointer {
  cursor: pointer;
}

.chibi-avatar-wrapper.is-mirrored {
  transform: scaleX(-1);
}

.chibi-canvas {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
  max-width: 100%;
  height: auto;
  background: transparent !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
}

.chibi-loading-spinner {
  position: absolute;
  width: 24px;
  height: 24px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #ffffff;
  border-radius: 50%;
  animation: chibi-spin 0.8s linear infinite;
}

@keyframes chibi-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
