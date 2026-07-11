<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import UeIcon from './UeIcon.vue';

/**
 * Shared grid popover. One row of cells picks a column count; a rows × cols
 * matrix picks a table size — same hover-to-preview interaction, one component.
 */
const props = withDefaults(
  defineProps<{
    icon: string;
    title: string;
    rows?: number;
    cols: number;
    disabled?: boolean;
    /** `{rows}` / `{cols}` / `{n}` are substituted into this template. */
    hint: (value: { rows: number; cols: number }) => string;
  }>(),
  { rows: 1, disabled: false }
);

const emit = defineEmits<{ (e: 'pick', value: { rows: number; cols: number }): void }>();

const open = ref(false);
const hovered = ref({ rows: 0, cols: 0 });
const root = ref<HTMLElement>();

const isOn = (row: number, col: number) => row <= hovered.value.rows && col <= hovered.value.cols;

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  hovered.value = { rows: 0, cols: 0 };
}

function pick(row: number, col: number) {
  emit('pick', { rows: row, cols: col });
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
</script>

<template>
  <span ref="root" class="ue-popover">
    <button
      type="button"
      class="ue-tb-btn"
      :class="{ 'is-active': open }"
      :title="title"
      :disabled="disabled"
      @mousedown.prevent
      @click="toggle"
    >
      <UeIcon :name="icon" />
    </button>

    <div v-if="open" class="ue-popover__panel" @mouseleave="hovered = { rows: 0, cols: 0 }">
      <div
        class="ue-grid"
        :style="{ gridTemplateColumns: `repeat(${cols}, 16px)` }"
        role="grid"
        :aria-label="title"
      >
        <template v-for="row in rows" :key="row">
          <button
            v-for="col in cols"
            :key="`${row}-${col}`"
            type="button"
            class="ue-grid__cell"
            :class="{ 'is-on': isOn(row, col) }"
            :aria-label="hint({ rows: row, cols: col })"
            @mouseenter="hovered = { rows: row, cols: col }"
            @mousedown.prevent
            @click="pick(row, col)"
          />
        </template>
      </div>

      <div class="ue-grid__label">
        {{ hovered.cols ? hint(hovered) : title }}
      </div>
    </div>
  </span>
</template>
