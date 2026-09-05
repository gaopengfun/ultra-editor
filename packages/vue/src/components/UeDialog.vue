<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

let seq = 0;

const props = withDefaults(
  defineProps<{ modelValue: boolean; title?: string; width?: string; closeLabel?: string }>(),
  {
    width: '480px',
    closeLabel: 'Close'
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'closed'): void;
}>();

const panel = ref<HTMLElement>();
const body = ref<HTMLElement>();
const titleId = `ue-dialog-title-${(seq += 1)}`;
let lastFocused: HTMLElement | null = null;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root?: HTMLElement): HTMLElement[] {
  const scope = root ?? panel.value;
  return scope ? Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
}

/**
 * Where the caret goes when the dialog opens.
 *
 * Not `focusables()[0]`: the close button sits in the header, so in DOM order it
 * is always first, and a dialog that opens with focus on its own dismiss control
 * eats the user's first keystroke and closes on the first Enter. The content is
 * what the dialog was opened to fill in, so it gets the caret; a dialog with
 * nothing focusable in its body falls back to the close button, then the panel.
 */
function initialFocus(): HTMLElement | undefined {
  return focusables(body.value)[0] ?? focusables()[0] ?? panel.value;
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
  // The close button is always rendered, so an open panel always holds at least
  // one focusable — this only guards the indexing below.
  /* v8 ignore next 4 */
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
      void nextTick(() => initialFocus()?.focus());
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
          <button
            type="button"
            class="ue-dialog__close"
            :aria-label="closeLabel"
            :title="closeLabel"
            @click="close"
          >
            <svg class="ue-ico" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <div ref="body" class="ue-dialog__body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="ue-dialog__footer">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
