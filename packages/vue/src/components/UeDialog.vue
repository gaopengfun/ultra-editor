<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue';

const props = withDefaults(
  defineProps<{ modelValue: boolean; title?: string; width?: string }>(),
  { width: '480px' }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'closed'): void;
}>();

function close() {
  emit('update:modelValue', false);
}

const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') close();
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      window.addEventListener('keydown', onKey);
    } else {
      window.removeEventListener('keydown', onKey);
      emit('closed');
    }
  }
);

onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="ue-dialog"
      role="dialog"
      aria-modal="true"
      @mousedown.self="close"
    >
      <div class="ue-dialog__panel" :style="{ '--ue-dialog-width': width }">
        <header class="ue-dialog__header">
          <span>{{ title }}</span>
          <button type="button" class="ue-dialog__close" @click="close">
            <svg class="ue-ico" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <div class="ue-dialog__body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="ue-dialog__footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
