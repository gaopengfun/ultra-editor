<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';

/** Swatch palette plus a native colour input — no Element Plus, no dependency. */
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
  modelValue: string | null;
  title: string;
  clearLabel: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
  (e: 'clear'): void;
}>();

const open = ref(false);
const root = ref<HTMLElement>();

function pick(color: string) {
  emit('update:modelValue', color);
  open.value = false;
}

const onOutside = (event: MouseEvent) => {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
};

watch(open, (value) => {
  if (value) window.addEventListener('mousedown', onOutside, true);
  else window.removeEventListener('mousedown', onOutside, true);
});

onBeforeUnmount(() => window.removeEventListener('mousedown', onOutside, true));

defineExpose({ swatches: SWATCHES });
</script>

<template>
  <span ref="root" class="ue-popover">
    <button
      type="button"
      class="ue-color-trigger"
      :title="title"
      @mousedown.prevent
      @click="open = !open"
    >
      <span
        class="ue-color-trigger__chip"
        :style="{ background: props.modelValue || 'transparent' }"
      />
    </button>

    <div v-if="open" class="ue-popover__panel">
      <div class="ue-swatches">
        <button
          v-for="color in SWATCHES"
          :key="color"
          type="button"
          class="ue-swatch"
          :class="{ 'is-active': color === props.modelValue }"
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
          :value="props.modelValue || '#000000'"
          @input="pick(($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="ue-btn"
          @mousedown.prevent
          @click="
            emit('clear');
            open = false;
          "
        >
          {{ clearLabel }}
        </button>
      </div>
    </div>
  </span>
</template>
