<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import UeMenu from './UeMenu.vue';
import UeIcon from './UeIcon.vue';
import UeColorPanel from './UeColorPanel.vue';
import type { MessageKey, Translator } from '@ultra-editor/core';
import type { TableAction } from '../types';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  canMerge: boolean;
  canSplit: boolean;
  cellColor: string | null;
  t: Translator;
}>();

const emit = defineEmits<{
  (e: 'action', name: TableAction): void;
  (e: 'set-color', color: string): void;
  (e: 'clear-color'): void;
  (e: 'close'): void;
}>();

const STRUCTURE: Array<{ name: TableAction; icon: string; label: MessageKey }> = [
  { name: 'rowBefore', icon: 'arrowUp', label: 'table.rowBefore' },
  { name: 'rowAfter', icon: 'arrowDown', label: 'table.rowAfter' },
  { name: 'colBefore', icon: 'arrowLeft', label: 'table.colBefore' },
  { name: 'colAfter', icon: 'arrowRight', label: 'table.colAfter' }
];

const HEADERS: Array<{ name: TableAction; icon: string; label: MessageKey }> = [
  { name: 'headerRow', icon: 'table', label: 'table.headerRow' },
  { name: 'headerCol', icon: 'table', label: 'table.headerCol' }
];

function run(name: TableAction) {
  emit('action', name);
  emit('close');
}

const colorOpen = ref(false);
const colorRow = ref<HTMLButtonElement>();
const colorAnchor = ref({ x: 0, y: 0 });

// The flyout hangs off the menu's right edge, not the row's: the row is as wide
// as the menu minus its padding, and anchoring to it would tuck the panel under
// the menu's own border.
function openColor() {
  const row = colorRow.value;
  const menu = row?.closest<HTMLElement>('.ue-menu');
  // Only the colour row itself opens this, so by definition it is mounted and
  // inside the menu — the guard is for the types.
  /* v8 ignore next */
  if (!row || !menu) return;
  const rowRect = row.getBoundingClientRect();
  colorAnchor.value = { x: menu.getBoundingClientRect().right + 6, y: rowRect.top - 6 };
  colorOpen.value = true;
}

function closeColor() {
  colorOpen.value = false;
  void nextTick(() => colorRow.value?.focus());
}

function setColor(color: string) {
  emit('set-color', color);
  emit('close');
}

function clearColor() {
  emit('clear-color');
  emit('close');
}

// The menu can be dismissed while the flyout is open (Escape, a click away, a
// scroll); the flyout must not outlive it.
watch(
  () => props.visible,
  (open) => {
    if (!open) colorOpen.value = false;
  }
);
</script>

<template>
  <UeMenu :visible="visible" :x="x" :y="y" :label="t('toolbar.table')" @close="emit('close')">
    <button
      v-for="item in STRUCTURE"
      :key="item.name"
      type="button"
      class="ue-menu__item"
      role="menuitem"
      @click="run(item.name)"
    >
      <UeIcon :name="item.icon" />
      <span class="ue-menu__label">{{ t(item.label) }}</span>
    </button>

    <div class="ue-menu__divider" role="separator" />

    <button
      type="button"
      class="ue-menu__item"
      role="menuitem"
      :disabled="!canMerge"
      @click="run('merge')"
    >
      <UeIcon name="merge" />
      <span class="ue-menu__label">{{ t('table.merge') }}</span>
    </button>
    <button
      type="button"
      class="ue-menu__item"
      role="menuitem"
      :disabled="!canSplit"
      @click="run('split')"
    >
      <UeIcon name="split" />
      <span class="ue-menu__label">{{ t('table.split') }}</span>
    </button>

    <button
      v-for="item in HEADERS"
      :key="item.name"
      type="button"
      class="ue-menu__item"
      role="menuitem"
      @click="run(item.name)"
    >
      <UeIcon :name="item.icon" />
      <span class="ue-menu__label">{{ t(item.label) }}</span>
    </button>

    <div class="ue-menu__divider" role="separator" />

    <button
      ref="colorRow"
      type="button"
      class="ue-menu__item"
      role="menuitem"
      aria-haspopup="dialog"
      :aria-expanded="colorOpen"
      @click="openColor"
      @keydown.right.prevent="openColor"
    >
      <UeIcon name="palette" />
      <span class="ue-menu__label">{{ t('table.cellColor') }}</span>
      <span
        class="ue-menu__chip"
        :class="{ 'ue-menu__chip--none': !cellColor }"
        :style="cellColor ? { background: cellColor } : undefined"
      />
      <UeIcon name="chevronRight" class="ue-menu__caret" />
    </button>

    <UeColorPanel
      :visible="colorOpen"
      :x="colorAnchor.x"
      :y="colorAnchor.y"
      :model-value="cellColor"
      :label="t('table.cellColor')"
      :clear-label="t('table.clearColor')"
      @update:model-value="setColor"
      @clear="clearColor"
      @close="closeColor"
    />

    <div class="ue-menu__divider" role="separator" />

    <button
      type="button"
      class="ue-menu__item ue-menu__item--danger"
      role="menuitem"
      @click="run('delRow')"
    >
      <UeIcon name="trash" />
      <span class="ue-menu__label">{{ t('table.delRow') }}</span>
    </button>
    <button
      type="button"
      class="ue-menu__item ue-menu__item--danger"
      role="menuitem"
      @click="run('delCol')"
    >
      <UeIcon name="trash" />
      <span class="ue-menu__label">{{ t('table.delCol') }}</span>
    </button>
    <button
      type="button"
      class="ue-menu__item ue-menu__item--danger"
      role="menuitem"
      @click="run('delTable')"
    >
      <UeIcon name="trash" />
      <span class="ue-menu__label">{{ t('table.delTable') }}</span>
    </button>
  </UeMenu>
</template>
