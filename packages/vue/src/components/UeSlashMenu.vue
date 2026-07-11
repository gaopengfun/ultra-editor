<script setup lang="ts">
import { computed } from 'vue';
import UeIcon from './UeIcon.vue';
import type { SlashGroup, SlashItem, Translator } from '@ultra-editor/core';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: SlashItem[];
  index: number;
  t: Translator;
}>();

const emit = defineEmits<{
  (e: 'select', item: SlashItem): void;
  (e: 'hover', index: number): void;
}>();

const GROUP_LABEL = {
  basic: 'slash.group.basic',
  insert: 'slash.group.insert',
  ai: 'slash.group.ai'
} as const;

/** Flat list plus group headers, so keyboard indices stay simple integers. */
const groups = computed(() => {
  const order: SlashGroup[] = ['basic', 'insert', 'ai'];
  let cursor = 0;
  return order
    .map((group) => {
      const items = props.items
        .filter((item) => item.group === group)
        .map((item) => ({ item, index: cursor++ }));
      return { group, items };
    })
    .filter((entry) => entry.items.length > 0);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ue-menu ue-slash"
      :style="{ left: x + 'px', top: y + 'px' }"
      role="listbox"
    >
      <p v-if="!items.length" class="ue-menu__empty">{{ t('slash.empty') }}</p>

      <template v-for="group in groups" :key="group.group">
        <div class="ue-menu__group">{{ t(GROUP_LABEL[group.group]) }}</div>
        <button
          v-for="entry in group.items"
          :key="entry.item.key"
          type="button"
          class="ue-menu__item"
          role="option"
          :aria-selected="entry.index === index"
          :class="{ 'is-highlighted': entry.index === index }"
          @mouseenter="emit('hover', entry.index)"
          @mousedown.prevent
          @click="emit('select', entry.item)"
        >
          <UeIcon :name="entry.item.icon" />
          <span class="ue-menu__label">{{ t(entry.item.labelKey) }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
