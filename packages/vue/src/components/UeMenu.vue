<script setup lang="ts">
import { computed, nextTick, toRef, watch } from 'vue';
import { useFloating } from '../composables/useFloating';

const props = withDefaults(
  defineProps<{
    visible: boolean;
    x: number;
    y: number;
    label?: string;
    menuClass?: string;
    closeOnScroll?: boolean;
  }>(),
  { closeOnScroll: true }
);

const emit = defineEmits<{ (e: 'close'): void }>();

const anchor = computed(() => ({ x: props.x, y: props.y }));
const { element, position } = useFloating(toRef(props, 'visible'), anchor, () => emit('close'), {
  closeOnScroll: props.closeOnScroll
});

function items(): HTMLElement[] {
  return element.value
    ? Array.from(element.value.querySelectorAll<HTMLElement>('button.ue-menu__item:not(:disabled)'))
    : [];
}

function focusAt(index: number) {
  const list = items();
  if (!list.length) return;
  list[((index % list.length) + list.length) % list.length].focus();
}

// Arrow keys move a roving focus through the items; disabled ones are skipped.
// Escape and outside-click close are already handled by useFloating.
function onKeydown(event: KeyboardEvent) {
  const list = items();
  if (!list.length) return;
  const current = list.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusAt(current + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusAt(current - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusAt(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusAt(list.length - 1);
  }
}

// Opening drops focus on the first item so the menu is operable from the
// keyboard; closing returns focus to wherever it came from (the editor keeps its
// selection in state regardless, so actions still hit the right node).
let returnFocus: HTMLElement | null = null;
watch(
  () => props.visible,
  (open) => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null;
      void nextTick(() => focusAt(0));
    } else if (returnFocus) {
      returnFocus.focus?.();
      returnFocus = null;
    }
  }
);

defineExpose({ element });
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="element"
      class="ue-menu"
      :class="menuClass"
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
      role="menu"
      :aria-label="label"
      @contextmenu.prevent
      @keydown="onKeydown"
    >
      <slot />
    </div>
  </Teleport>
</template>
