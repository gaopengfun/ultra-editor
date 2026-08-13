<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import UeIcon from './UeIcon.vue';
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
const root = ref<HTMLElement>();

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
  rect.value = {
    left: Math.max(12, (start.left + end.left) / 2),
    top: Math.max(12, start.top - 12)
  };
  visible.value = true;
}

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

onMounted(() => {
  props.editor.on('selectionUpdate', update);
  props.editor.on('transaction', update);
  props.editor.on('blur', update);
});

onBeforeUnmount(() => {
  props.editor.off('selectionUpdate', update);
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
      :style="{ left: rect.left + 'px', top: rect.top + 'px', transform: 'translate(-50%, -100%)' }"
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
        class="ue-menu"
        role="menu"
        :style="{ left: '0', top: 'calc(100% + 6px)', position: 'absolute' }"
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
