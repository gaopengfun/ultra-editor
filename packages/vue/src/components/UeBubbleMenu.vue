<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import UeIcon from './UeIcon.vue';
import { clampToViewport } from '../composables/useFloating';
import type { AITask, MessageKey, Translator } from '@ultra-editor/core/lean';

/**
 * Selection bubble. Formatting on the left, the AI menu on the right — AI is a
 * first-class citizen of the selection, not a button parked in the toolbar.
 */
const props = defineProps<{
  editor: Editor;
  tasks: AITask[];
  hasAI: boolean;
  t: Translator;
}>();

const emit = defineEmits<{ (e: 'ai', task: AITask): void }>();

const visible = ref(false);
const rect = ref({ left: 0, top: 0 });
const menuOpen = ref(false);
const menuAbove = ref(false);
const root = ref<HTMLElement>();
const taskMenu = ref<HTMLElement>();

const TASK_LABEL: Record<string, MessageKey> = {
  improve: 'ai.improve',
  translate: 'ai.translate',
  summarize: 'ai.summarize',
  rewrite: 'ai.rewrite',
  expand: 'ai.expand',
  shorten: 'ai.shorten',
  fixGrammar: 'ai.fixGrammar',
  changeTone: 'ai.changeTone',
  continue: 'ai.continue',
  custom: 'ai.custom'
};

const aiTasks = computed(() => props.tasks.filter((task) => task in TASK_LABEL));

const GAP = 8;
/** Last measured size, so a re-show lands in the right place on its first frame. */
let box = { width: 0, height: 0 };

type Coords = { left: number; top: number; bottom: number };

/**
 * Centre the bubble over the selection, above it by preference.
 *
 * Above is where it stays out of the way of what is being written, but a
 * selection on the first visible line has no room there — and clamping down into
 * the viewport would only park the bubble on top of the words it belongs to, so
 * it flips underneath instead. Sizes are measured rather than assumed: the bar
 * is wider in English than in Chinese, and wider again once a provider adds the
 * AI entry, which is exactly when it starts running off a narrow window.
 */
function positionFor(start: Coords, end: Coords, size: { width: number; height: number }) {
  const above = start.top - size.height - GAP;
  const top = above >= GAP ? above : end.bottom + GAP;
  return clampToViewport({ x: (start.left + end.left) / 2 - size.width / 2, y: top }, size, GAP);
}

function update() {
  const { editor } = props;
  const { state, view } = editor;
  const { from, to, empty } = state.selection;

  if (empty || !editor.isEditable || !view.hasFocus()) {
    // Keep the bubble alive while its own menu has focus.
    if (!menuOpen.value) visible.value = false;
    return;
  }

  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  rect.value = positionFor(start, end, box);
  visible.value = true;

  void nextTick(() => {
    const el = root.value;
    if (!el) return;
    const measured = el.getBoundingClientRect();
    box = { width: measured.width, height: measured.height };
    rect.value = positionFor(start, end, box);
  });
}

/**
 * Hang the task list off whichever side of the bubble has room for it.
 *
 * The bubble is `position: fixed`, so a list that runs past the bottom of the
 * window cannot be scrolled into view — with ten tasks it is tall enough that a
 * selection in the lower half of a phone-sized window puts half of them out of
 * reach for good.
 */
watch(menuOpen, (open) => {
  if (!open) {
    menuAbove.value = false;
    return;
  }
  void nextTick(() => {
    // Opening the list is what schedules this, and `update()` keeps the bubble
    // mounted for as long as the list is open — so the element is always here by
    // the time the tick runs. Unmounting cancels the watcher job outright rather
    // than arriving here with nothing to measure.
    const el = taskMenu.value;
    /* v8 ignore next */
    if (!el) return;
    const height = el.getBoundingClientRect().height;
    const fitsBelow = rect.value.top + box.height + GAP + height <= window.innerHeight;
    menuAbove.value = !fitsBelow && rect.value.top - GAP - height >= GAP;
  });
});

function pick(task: AITask) {
  menuOpen.value = false;
  visible.value = false;
  emit('ai', task);
}

// A click anywhere outside the bubble dismisses it — including its open AI
// submenu, which `update()` alone leaves stranded (it keeps the bubble alive
// while the menu is open). The bubble's own buttons use mousedown.prevent, so
// they never reach here. Capture phase, mirroring UeColorPicker.
const onOutside = (event: MouseEvent) => {
  if (root.value && !root.value.contains(event.target as Node)) {
    menuOpen.value = false;
    visible.value = false;
  }
};

watch(visible, (value) => {
  if (value) window.addEventListener('mousedown', onOutside, true);
  else window.removeEventListener('mousedown', onOutside, true);
});

// `transaction` alone, not `transaction` + `selectionUpdate`: Tiptap emits the
// former for every dispatch it applies and the latter immediately after, on the
// same dispatch, whenever the selection moved. Listening to both re-ran `update`
// twice for one transaction — and each run measures two document positions, which
// forces layout.
onMounted(() => {
  props.editor.on('transaction', update);
  props.editor.on('blur', update);
});

onBeforeUnmount(() => {
  props.editor.off('transaction', update);
  props.editor.off('blur', update);
  window.removeEventListener('mousedown', onOutside, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="root"
      class="ue-bubble"
      :style="{ left: rect.left + 'px', top: rect.top + 'px' }"
    >
      <button
        type="button"
        class="ue-bubble__btn"
        :class="{ 'is-active': editor.isActive('bold') }"
        :title="t('toolbar.bold')"
        @mousedown.prevent
        @click="editor.chain().focus().toggleBold().run()"
      >
        <UeIcon name="bold" />
      </button>
      <button
        type="button"
        class="ue-bubble__btn"
        :class="{ 'is-active': editor.isActive('italic') }"
        :title="t('toolbar.italic')"
        @mousedown.prevent
        @click="editor.chain().focus().toggleItalic().run()"
      >
        <UeIcon name="italic" />
      </button>
      <button
        type="button"
        class="ue-bubble__btn"
        :class="{ 'is-active': editor.isActive('code') }"
        :title="t('toolbar.code')"
        @mousedown.prevent
        @click="editor.chain().focus().toggleCode().run()"
      >
        <UeIcon name="code" />
      </button>

      <template v-if="hasAI && aiTasks.length">
        <span class="ue-tb-divider" />
        <button
          type="button"
          class="ue-bubble__btn ue-bubble__btn--ai"
          :title="t('toolbar.ai')"
          :aria-label="t('toolbar.ai')"
          aria-haspopup="menu"
          :aria-expanded="menuOpen"
          @mousedown.prevent
          @click="menuOpen = !menuOpen"
        >
          <UeIcon name="ai" />
          {{ t('toolbar.ai') }}
        </button>
      </template>

      <div
        v-if="menuOpen"
        ref="taskMenu"
        class="ue-menu"
        role="menu"
        :style="
          menuAbove
            ? { left: '0', bottom: 'calc(100% + 6px)', position: 'absolute' }
            : { left: '0', top: 'calc(100% + 6px)', position: 'absolute' }
        "
      >
        <button
          v-for="task in aiTasks"
          :key="task"
          type="button"
          class="ue-menu__item"
          role="menuitem"
          @mousedown.prevent
          @click="pick(task)"
        >
          <UeIcon name="ai" />
          <span class="ue-menu__label">{{ t(TASK_LABEL[task]) }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>
