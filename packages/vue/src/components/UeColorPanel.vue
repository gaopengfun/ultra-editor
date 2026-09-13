<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { hexToHsv, hsvToHex, normalizeHex, type Translator } from '@ultra-editor/core/lean';
import { useFloating } from '../composables/useFloating';

/**
 * The swatch palette, as a floating surface.
 *
 * Teleported and fixed-positioned rather than absolutely positioned inside its
 * trigger: the table context menu is a scroll container, and a panel rendered
 * inside it can only be clipped — it cannot escape to show itself.
 *
 * The custom picker is drawn here rather than delegated to `<input type="color">`.
 * That control renders a chip the browser styles and opens the browser's own
 * picker on top of the page — square corners, system number fields, a system
 * eyedropper — and none of it can be restyled to match the editor.
 */
const SWATCHES = [
  '#1f2937',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#16a34a',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#78716c',
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#22d3ee',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#ffffff',
  '#e5e7eb',
  '#9ca3af',
  '#4b5563',
  '#111827',
  '#51a5dc'
];

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  modelValue: string | null;
  label: string;
  clearLabel: string;
  t: Translator;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'clear'): void;
  (e: 'close'): void;
}>();

const anchor = computed(() => ({ x: props.x, y: props.y }));
const { element, position, place } = useFloating(toRef(props, 'visible'), anchor, () =>
  emit('close')
);

function pick(color: string) {
  emit('update:modelValue', color);
  emit('close');
}

function clear() {
  emit('clear');
  emit('close');
}

/* Custom colour ------------------------------------------------------------- */

const custom = ref(false);
// Full saturation and value on red, so an author who opens the picker with no
// colour set lands on a live gradient rather than a black square.
const hue = ref(0);
const saturation = ref(1);
const value = ref(1);
const hex = ref('#ff0000');

const draft = computed(() => hsvToHex({ h: hue.value, s: saturation.value, v: value.value }));
const pure = computed(() => hsvToHex({ h: hue.value, s: 1, v: 1 }));
const valid = computed(() => normalizeHex(hex.value) !== null);

/** Move the wheel onto a colour, without touching what is typed in the field. */
function adopt(color: string) {
  const hsv = hexToHsv(color);
  if (!hsv) return;
  // A grey has no hue to read — every channel is equal, so the angle is undefined
  // and `hexToHsv` reports 0. Leaving the rail where it stands means dragging
  // saturation back up continues the colour the author was on, rather than
  // snapping them to red.
  if (hsv.s > 0) hue.value = hsv.h;
  saturation.value = hsv.s;
  value.value = hsv.v;
}

async function toggleCustom() {
  custom.value = !custom.value;
  if (!custom.value) return;
  if (props.modelValue) adopt(props.modelValue);
  hex.value = draft.value;
  // The panel just grew a section; from a trigger near the bottom of the window
  // it would otherwise hang off the edge.
  await nextTick();
  void place();
}

const clamp = (value: number, size: number) =>
  size > 0 ? Math.min(1, Math.max(0, value / size)) : 0;

function track(event: PointerEvent) {
  const target = event.currentTarget as HTMLElement;
  // Capture, so a drag that leaves the swatch still steers it — letting go of the
  // pointer outside is the normal way to finish a drag, not a reason to stop.
  if (event.type === 'pointerdown') target.setPointerCapture(event.pointerId);
  else if (!target.hasPointerCapture(event.pointerId)) return null;
  return target.getBoundingClientRect();
}

function onAreaPointer(event: PointerEvent) {
  const rect = track(event);
  if (!rect) return;
  saturation.value = clamp(event.clientX - rect.left, rect.width);
  value.value = 1 - clamp(event.clientY - rect.top, rect.height);
  hex.value = draft.value;
}

function onHuePointer(event: PointerEvent) {
  const rect = track(event);
  if (!rect) return;
  hue.value = clamp(event.clientX - rect.left, rect.width) * 360;
  hex.value = draft.value;
}

/** Arrow keys, so the picker is reachable without a pointer. Shift takes bigger steps. */
function onAreaKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 0.1 : 0.02;
  const moves: Record<string, () => void> = {
    ArrowLeft: () => (saturation.value = Math.max(0, saturation.value - step)),
    ArrowRight: () => (saturation.value = Math.min(1, saturation.value + step)),
    ArrowDown: () => (value.value = Math.max(0, value.value - step)),
    ArrowUp: () => (value.value = Math.min(1, value.value + step))
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  move();
  hex.value = draft.value;
}

function onHueKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 30 : 2;
  const delta = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
  if (!delta) return;
  event.preventDefault();
  hue.value = (hue.value + delta + 360) % 360;
  hex.value = draft.value;
}

function onHexInput(event: Event) {
  const typed = (event.target as HTMLInputElement).value;
  hex.value = typed;
  const color = normalizeHex(typed);
  // Half-typed input steers nothing; the field keeps whatever is in it either way,
  // so `#5b5` does not get rewritten out from under the next keystroke.
  if (color) adopt(color);
}

function apply() {
  const color = normalizeHex(hex.value);
  if (!color) return;
  pick(color);
}

// Taking focus is what makes Escape unambiguous: the parent menu ignores an
// Escape raised inside a flyout, so the first press closes only this panel.
watch(
  () => props.visible,
  (open) => {
    if (!open) return;
    // Reopen compact. The palette answers most picks, and a panel that remembered
    // being expanded would cover the document for everyone who never wanted it.
    custom.value = false;
    void nextTick(() => element.value?.querySelector<HTMLElement>('.ue-swatch')?.focus());
  }
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="element"
      class="ue-color-panel"
      data-ue-flyout
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
      role="dialog"
      :aria-label="label"
    >
      <div class="ue-swatches">
        <button
          v-for="color in SWATCHES"
          :key="color"
          type="button"
          class="ue-swatch"
          :class="{ 'is-active': color === modelValue }"
          :style="{ background: color }"
          :aria-label="color"
          @mousedown.prevent
          @click="pick(color)"
        />
      </div>

      <div class="ue-color-actions">
        <button
          type="button"
          class="ue-btn ue-color-custom"
          :aria-expanded="custom"
          @mousedown.prevent
          @click="toggleCustom"
        >
          <span class="ue-color-custom__chip" :style="{ background: draft }" />
          {{ t('color.custom') }}
        </button>
        <button type="button" class="ue-btn" @mousedown.prevent @click="clear">
          {{ clearLabel }}
        </button>
      </div>

      <div v-if="custom" class="ue-color-picker">
        <div
          class="ue-color-area"
          tabindex="0"
          :style="{ '--ue-color-pure': pure }"
          :aria-label="t('color.area')"
          @mousedown.prevent
          @pointerdown="onAreaPointer"
          @pointermove="onAreaPointer"
          @keydown="onAreaKey"
        >
          <span
            class="ue-color-area__thumb"
            :style="{
              left: saturation * 100 + '%',
              top: (1 - value) * 100 + '%',
              background: draft
            }"
          />
        </div>

        <div
          class="ue-color-hue"
          role="slider"
          tabindex="0"
          :aria-label="t('color.hue')"
          aria-valuemin="0"
          aria-valuemax="360"
          :aria-valuenow="Math.round(hue)"
          @mousedown.prevent
          @pointerdown="onHuePointer"
          @pointermove="onHuePointer"
          @keydown="onHueKey"
        >
          <span
            class="ue-color-hue__thumb"
            :style="{ left: (hue / 360) * 100 + '%', background: pure }"
          />
        </div>

        <div class="ue-color-entry">
          <input
            class="ue-input ue-color-hex"
            :class="{ 'ue-input--error': !valid }"
            :value="hex"
            :aria-label="t('color.hex')"
            spellcheck="false"
            @input="onHexInput"
            @keydown.enter.prevent="apply"
          />
          <button
            type="button"
            class="ue-btn ue-btn--primary"
            :disabled="!valid"
            @mousedown.prevent
            @click="apply"
          >
            {{ t('color.apply') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
