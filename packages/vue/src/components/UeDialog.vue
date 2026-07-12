<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

let seq = 0;

const props = withDefaults(defineProps<{ modelValue: boolean; title?: string; width?: string }>(), {
  width: '480px'
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'closed'): void;
}>();

const panel = ref<HTMLElement>();
const titleId = `ue-dialog-title-${(seq += 1)}`;
let lastFocused: HTMLElement | null = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  return panel.value ? Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

function close() {
  emit('update:modelValue', false);
}

// Escape closes; Tab is trapped so keyboard focus can't wander onto the page
// behind an aria-modal dialog (there is no real backdrop to stop it otherwise).
const onKey = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const outside = !panel.value?.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      lastFocused = document.activeElement as HTMLElement | null;
      window.addEventListener('keydown', onKey, true);
      void nextTick(() => (focusables()[0] ?? panel.value)?.focus());
    } else {
      window.removeEventListener('keydown', onKey, true);
      // Hand focus back to whatever opened the dialog.
      lastFocused?.focus?.();
      lastFocused = null;
      emit('closed');
    }
  }
);

onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="ue-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="title ? titleId : undefined"
      @mousedown.self="close"
    >
      <div
        ref="panel"
        class="ue-dialog__panel"
        tabindex="-1"
        :style="{ '--ue-dialog-width': width }"
      >
        <header class="ue-dialog__header">
          <span :id="titleId">{{ title }}</span>
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
