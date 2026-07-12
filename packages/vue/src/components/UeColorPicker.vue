<script setup lang="ts">
import { ref } from 'vue';
import UeColorPanel from './UeColorPanel.vue';

/** Swatch chip that opens the shared colour panel — no Element Plus, no dependency. */
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
const trigger = ref<HTMLButtonElement>();
const anchor = ref({ x: 0, y: 0 });

function toggle() {
  if (open.value) {
    open.value = false;
    return;
  }
  const rect = trigger.value?.getBoundingClientRect();
  if (rect) anchor.value = { x: rect.left, y: rect.bottom + 6 };
  open.value = true;
}
</script>

<template>
  <span class="ue-popover">
    <button
      ref="trigger"
      type="button"
      class="ue-color-trigger"
      :title="props.title"
      :aria-label="props.title"
      aria-haspopup="dialog"
      :aria-expanded="open"
      @mousedown.prevent
      @click="toggle"
    >
      <span
        class="ue-color-trigger__chip"
        :style="{ background: props.modelValue || 'transparent' }"
      />
    </button>

    <UeColorPanel
      :visible="open"
      :x="anchor.x"
      :y="anchor.y"
      :model-value="props.modelValue"
      :label="props.title"
      :clear-label="props.clearLabel"
      @update:model-value="emit('update:modelValue', $event)"
      @clear="emit('clear')"
      @close="open = false"
    />
  </span>
</template>
