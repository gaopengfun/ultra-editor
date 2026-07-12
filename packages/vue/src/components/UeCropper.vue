<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import UeDialog from './UeDialog.vue';
import UeIcon from './UeIcon.vue';
import { transformImage, type ImageFetcher, type Translator } from '@ultra-editor/core';

/**
 * Crop / rotate / flip, built on a plain canvas.
 *
 * This exists so the SDK doesn't drag `vue-advanced-cropper` (and its styles)
 * into every consumer's bundle for one dialog. The crop box is expressed in the
 * image's natural pixels, so the exported blob is full resolution regardless of
 * how the preview is scaled to fit the dialog.
 */
const props = defineProps<{
  modelValue: boolean;
  src: string;
  fetchImage?: ImageFetcher;
  t: Translator;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'confirm', blob: Blob): void;
  (e: 'error', message: string): void;
}>();

type Box = { left: number; top: number; width: number; height: number };

const objectUrl = ref('');
const natural = ref({ width: 0, height: 0 });
const crop = ref<Box>({ left: 0, top: 0, width: 0, height: 0 });
const rotate = ref<0 | 90 | 180 | 270>(0);
const flipH = ref(false);
const flipV = ref(false);
const loading = ref(false);
const exporting = ref(false);
const stage = ref<HTMLElement>();

// Invalidates in-flight loads: reopening the dialog fast enough would otherwise
// let a stale response overwrite the object URL of the current one and leak it.
let loadToken = 0;

const scale = computed(() => {
  const el = stage.value;
  if (!el || !natural.value.width) return 1;
  const box = el.getBoundingClientRect();
  return Math.min(box.width / natural.value.width, box.height / natural.value.height, 1);
});

const cropStyle = computed(() => ({
  left: `${crop.value.left * scale.value}px`,
  top: `${crop.value.top * scale.value}px`,
  width: `${crop.value.width * scale.value}px`,
  height: `${crop.value.height * scale.value}px`
}));

const imageStyle = computed(() => ({
  width: `${natural.value.width * scale.value}px`,
  height: `${natural.value.height * scale.value}px`
}));

function revoke() {
  loadToken++;
  if (objectUrl.value.startsWith('blob:')) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = '';
}

async function load(src: string) {
  revoke();
  const token = ++loadToken;
  loading.value = true;
  try {
    const blob = await (props.fetchImage
      ? props.fetchImage(src)
      : fetch(src, { credentials: 'same-origin' }).then((response) => response.blob()));
    if (token !== loadToken) return;
    objectUrl.value = URL.createObjectURL(blob);
  } catch {
    if (token !== loadToken) return;
    // Same-origin images still crop fine straight from the URL; cross-origin ones
    // fail at export time with a clear message.
    objectUrl.value = src;
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

function onImageLoad(event: Event) {
  const img = event.target as HTMLImageElement;
  natural.value = { width: img.naturalWidth, height: img.naturalHeight };
  reset();
}

function reset() {
  crop.value = {
    left: 0,
    top: 0,
    width: natural.value.width,
    height: natural.value.height
  };
  rotate.value = 0;
  flipH.value = false;
  flipV.value = false;
}

function turn(direction: 1 | -1) {
  rotate.value = ((((rotate.value + direction * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

// Unmounting mid-drag (e.g. the editor is torn down while a handle is held)
// would otherwise strand the document-level mousemove/mouseup listeners.
let stopDrag: (() => void) | null = null;

/** Drag handles: `move` shifts the box, the corners resize it. */
function startDrag(event: MouseEvent, handle: 'move' | 'nw' | 'ne' | 'sw' | 'se') {
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY };
  const origin = { ...crop.value };
  const ratio = scale.value || 1;
  const bounds = natural.value;
  const MIN = 24;

  const onMove = (move: MouseEvent) => {
    const dx = (move.clientX - start.x) / ratio;
    const dy = (move.clientY - start.y) / ratio;
    const next = { ...origin };

    if (handle === 'move') {
      next.left = Math.min(Math.max(0, origin.left + dx), bounds.width - origin.width);
      next.top = Math.min(Math.max(0, origin.top + dy), bounds.height - origin.height);
    } else {
      if (handle === 'nw' || handle === 'sw') {
        const left = Math.min(Math.max(0, origin.left + dx), origin.left + origin.width - MIN);
        next.width = origin.width + (origin.left - left);
        next.left = left;
      } else {
        next.width = Math.min(Math.max(MIN, origin.width + dx), bounds.width - origin.left);
      }
      if (handle === 'nw' || handle === 'ne') {
        const top = Math.min(Math.max(0, origin.top + dy), origin.top + origin.height - MIN);
        next.height = origin.height + (origin.top - top);
        next.top = top;
      } else {
        next.height = Math.min(Math.max(MIN, origin.height + dy), bounds.height - origin.top);
      }
    }
    crop.value = next;
  };

  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    stopDrag = null;
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  stopDrag = onUp;
}

async function confirm() {
  if (exporting.value || !natural.value.width) return;
  exporting.value = true;
  try {
    const blob = await transformImage(
      objectUrl.value || props.src,
      {
        crop: {
          left: Math.round(crop.value.left),
          top: Math.round(crop.value.top),
          width: Math.round(crop.value.width),
          height: Math.round(crop.value.height)
        },
        rotate: rotate.value,
        flipH: flipH.value,
        flipV: flipV.value
      },
      props.fetchImage
    );
    emit('confirm', blob);
    close();
  } catch {
    emit('error', props.t('image.exportFailed'));
  } finally {
    exporting.value = false;
  }
}

function close() {
  emit('update:modelValue', false);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open && props.src) void load(props.src);
    else revoke();
  }
);

onBeforeUnmount(() => {
  stopDrag?.();
  revoke();
});
</script>

<template>
  <UeDialog
    :model-value="modelValue"
    :title="t('image.cropTitle')"
    width="760px"
    @update:model-value="close"
  >
    <div ref="stage" class="ue-crop__stage">
      <div v-if="loading" class="ue-crop__loading">…</div>

      <div
        v-else-if="objectUrl"
        class="ue-crop__canvas"
        :style="{
          transform: `rotate(${rotate}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`
        }"
      >
        <img class="ue-crop__img" :src="objectUrl" :style="imageStyle" alt="" @load="onImageLoad" />

        <div class="ue-crop__box" :style="cropStyle" @mousedown="startDrag($event, 'move')">
          <span
            class="ue-crop__handle ue-crop__handle--nw"
            @mousedown.stop="startDrag($event, 'nw')"
          />
          <span
            class="ue-crop__handle ue-crop__handle--ne"
            @mousedown.stop="startDrag($event, 'ne')"
          />
          <span
            class="ue-crop__handle ue-crop__handle--sw"
            @mousedown.stop="startDrag($event, 'sw')"
          />
          <span
            class="ue-crop__handle ue-crop__handle--se"
            @mousedown.stop="startDrag($event, 'se')"
          />
        </div>
      </div>
    </div>

    <div class="ue-crop__tools">
      <button type="button" class="ue-btn" :title="t('image.rotateCcw')" @click="turn(-1)">
        <UeIcon name="rotateCcw" />
      </button>
      <button type="button" class="ue-btn" :title="t('image.rotateCw')" @click="turn(1)">
        <UeIcon name="rotateCw" />
      </button>
      <button type="button" class="ue-btn" :title="t('image.flipH')" @click="flipH = !flipH">
        <UeIcon name="flipH" />
      </button>
      <button type="button" class="ue-btn" :title="t('image.flipV')" @click="flipV = !flipV">
        <UeIcon name="flipV" />
      </button>
      <button type="button" class="ue-btn" :title="t('image.reset')" @click="reset">
        <UeIcon name="reset" />
      </button>
    </div>

    <template #footer>
      <button type="button" class="ue-btn" @click="close">{{ t('common.cancel') }}</button>
      <button type="button" class="ue-btn ue-btn--primary" :disabled="exporting" @click="confirm">
        {{ t('common.confirm') }}
      </button>
    </template>
  </UeDialog>
</template>
