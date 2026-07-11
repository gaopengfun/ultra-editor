<script setup lang="ts">
import UeMenu from './UeMenu.vue';
import UeIcon from './UeIcon.vue';
import UeColorPicker from './UeColorPicker.vue';
import type { MessageKey, Translator } from '@ultra-editor/core';
import type { TableAction } from '../types';

defineProps<{
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
</script>

<template>
  <UeMenu
    :visible="visible"
    :x="x"
    :y="y"
    :label="t('toolbar.table')"
    @close="emit('close')"
  >
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

    <button type="button" class="ue-menu__item" role="menuitem" :disabled="!canMerge" @click="run('merge')">
      <UeIcon name="merge" />
      <span class="ue-menu__label">{{ t('table.merge') }}</span>
    </button>
    <button type="button" class="ue-menu__item" role="menuitem" :disabled="!canSplit" @click="run('split')">
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

    <div class="ue-menu__item" role="none" @mousedown.stop>
      <UeIcon name="palette" />
      <span class="ue-menu__label">{{ t('table.cellColor') }}</span>
      <UeColorPicker
        :model-value="cellColor"
        :title="t('table.cellColor')"
        :clear-label="t('table.clearColor')"
        @update:model-value="emit('set-color', $event)"
        @clear="emit('clear-color')"
      />
    </div>

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
