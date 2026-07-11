<script setup lang="ts">
import { computed, toRef } from 'vue';
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
const { element, position } = useFloating(
  toRef(props, 'visible'),
  anchor,
  () => emit('close'),
  { closeOnScroll: props.closeOnScroll }
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
    >
      <slot />
    </div>
  </Teleport>
</template>
