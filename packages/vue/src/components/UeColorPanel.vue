<script setup lang="ts">
import { computed, nextTick, toRef, watch } from 'vue';
import { useFloating } from '../composables/useFloating';

/**
 * The swatch palette, as a floating surface.
 *
 * Teleported and fixed-positioned rather than absolutely positioned inside its
 * trigger: the table context menu is a scroll container, and a panel rendered
 * inside it can only be clipped — it cannot escape to show itself.
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
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'clear'): void;
  (e: 'close'): void;
}>();

const anchor = computed(() => ({ x: props.x, y: props.y }));
const { element, position } = useFloating(toRef(props, 'visible'), anchor, () => emit('close'));

function pick(color: string) {
  emit('update:modelValue', color);
  emit('close');
}

function clear() {
  emit('clear');
  emit('close');
}

// Taking focus is what makes Escape unambiguous: the parent menu ignores an
// Escape raised inside a flyout, so the first press closes only this panel.
watch(
  () => props.visible,
  (open) => {
    if (!open) return;
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
        <input
          type="color"
          class="ue-input ue-color-native"
          :aria-label="label"
          :value="modelValue || '#000000'"
          @input="pick(($event.target as HTMLInputElement).value)"
        />
        <button type="button" class="ue-btn" @mousedown.prevent @click="clear">
          {{ clearLabel }}
        </button>
      </div>
    </div>
  </Teleport>
</template>
