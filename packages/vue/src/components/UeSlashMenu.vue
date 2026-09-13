<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import UeIcon from './UeIcon.vue';
import { clampToViewport } from '../composables/useFloating';
import type { SlashItem, Translator } from '@ultra-editor/core/lean';

/**
 * `items` arrives already grouped (see `orderSlashItems` in UltraEditor) and this
 * component renders it in order, inserting a header when the group changes.
 *
 * It deliberately does NOT re-sort: doing so here would make the rendered order
 * differ from the array the keyboard handler indexes into, so Enter would run a
 * different command than the one highlighted.
 */
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

const rows = computed(() =>
  props.items.map((item, index) => ({
    item,
    index,
    startsGroup: index === 0 || props.items[index - 1].group !== item.group
  }))
);

const element = ref<HTMLElement>();
const position = ref({ left: props.x, top: props.y });

/**
 * Draw at the caret, then measure and pull back inside the viewport.
 *
 * The height has to be measured rather than assumed: filtering the query shrinks
 * the list row by row, and the AI group only exists when a provider is wired up.
 */
async function place() {
  position.value = { left: props.x, top: props.y };
  await nextTick();
  if (!element.value) return;
  position.value = clampToViewport(
    { x: props.x, y: props.y },
    element.value.getBoundingClientRect()
  );
}

watch(
  () => [props.visible, props.x, props.y, props.items.length],
  () => {
    if (props.visible) void place();
  },
  { immediate: true }
);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="element"
      class="ue-menu ue-slash"
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
      role="listbox"
    >
      <p v-if="!items.length" class="ue-menu__empty">{{ t('slash.empty') }}</p>

      <template v-for="row in rows" :key="row.item.key">
        <div v-if="row.startsGroup" class="ue-menu__group">
          {{ t(GROUP_LABEL[row.item.group]) }}
        </div>
        <button
          type="button"
          class="ue-menu__item"
          role="option"
          :aria-selected="row.index === index"
          :class="{ 'is-highlighted': row.index === index }"
          @mouseenter="emit('hover', row.index)"
          @mousedown.prevent
          @click="emit('select', row.item)"
        >
          <UeIcon :name="row.item.icon" />
          <span class="ue-menu__label">{{ t(row.item.labelKey) }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
