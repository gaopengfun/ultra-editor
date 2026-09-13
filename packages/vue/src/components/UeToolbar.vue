<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import UeIcon from './UeIcon.vue';
import UeGridPicker from './UeGridPicker.vue';
import UeColorPicker from './UeColorPicker.vue';
import { MAX_COLUMNS, type Translator } from '@ultra-editor/core/lean';

const props = defineProps<{
  editor: Editor;
  color: string | null;
  hasAI: boolean;
  /** Whether to offer the Markdown source toggle at all. */
  hasMarkdown: boolean;
  /** In source mode the document is a textarea, so formatting controls make no sense. */
  sourceMode: boolean;
  t: Translator;
}>();

const emit = defineEmits<{
  (e: 'color', value: string): void;
  (e: 'clear-color'): void;
  (e: 'link'): void;
  (e: 'image'): void;
  (e: 'ai'): void;
  (e: 'toggle-source'): void;
}>();

const MARKS = [
  { name: 'bold', icon: 'bold', label: 'toolbar.bold' },
  { name: 'italic', icon: 'italic', label: 'toolbar.italic' },
  { name: 'underline', icon: 'underline', label: 'toolbar.underline' },
  { name: 'strike', icon: 'strike', label: 'toolbar.strike' },
  { name: 'code', icon: 'code', label: 'toolbar.code' }
] as const;

const BLOCKS = [
  { name: 'bulletList', icon: 'bulletList', label: 'toolbar.bulletList' },
  { name: 'orderedList', icon: 'orderedList', label: 'toolbar.orderedList' },
  { name: 'blockquote', icon: 'quote', label: 'toolbar.blockquote' },
  { name: 'codeBlock', icon: 'codeBlock', label: 'toolbar.codeBlock' }
] as const;

type MarkName = (typeof MARKS)[number]['name'];
type BlockName = (typeof BLOCKS)[number]['name'];

const toggleMark = (name: MarkName) => {
  const chain = props.editor.chain().focus();
  const actions: Record<MarkName, () => void> = {
    bold: () => chain.toggleBold().run(),
    italic: () => chain.toggleItalic().run(),
    underline: () => chain.toggleUnderline().run(),
    strike: () => chain.toggleStrike().run(),
    code: () => chain.toggleCode().run()
  };
  actions[name]();
};

const toggleBlock = (name: BlockName) => {
  const chain = props.editor.chain().focus();
  const actions: Record<BlockName, () => void> = {
    bulletList: () => chain.toggleBulletList().run(),
    orderedList: () => chain.toggleOrderedList().run(),
    blockquote: () => chain.toggleBlockquote().run(),
    codeBlock: () => chain.toggleCodeBlock().run()
  };
  actions[name]();
};

const insertColumns = ({ cols }: { cols: number }) =>
  props.editor.chain().focus().insertColumns(cols).run();

const insertTable = ({ rows, cols }: { rows: number; cols: number }) =>
  props.editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
</script>

<template>
  <div class="ue-toolbar" role="toolbar">
    <!-- Source mode replaces the document with a textarea; every control below
         acts on a document that is not on screen, so only the way out is shown. -->
    <button
      v-if="sourceMode"
      type="button"
      class="ue-tb-btn is-active"
      :title="t('markdown.exit')"
      :aria-pressed="true"
      @click="emit('toggle-source')"
    >
      <UeIcon name="markdown" />
      {{ t('markdown.exit') }}
    </button>

    <template v-if="!sourceMode">
      <button
        v-for="level in [1, 2, 3] as const"
        :key="level"
        type="button"
        class="ue-tb-btn"
        :class="{ 'is-active': editor.isActive('heading', { level }) }"
        :title="t(`toolbar.h${level}` as 'toolbar.h1')"
        @click="editor.chain().focus().toggleHeading({ level }).run()"
      >
        H{{ level }}
      </button>

      <span class="ue-tb-divider" />

      <button
        v-for="mark in MARKS"
        :key="mark.name"
        type="button"
        class="ue-tb-btn"
        :class="{ 'is-active': editor.isActive(mark.name) }"
        :title="t(mark.label)"
        @click="toggleMark(mark.name)"
      >
        <UeIcon :name="mark.icon" />
      </button>

      <UeColorPicker
        :model-value="color"
        :title="t('toolbar.color')"
        :clear-label="t('toolbar.clearColor')"
        :t="t"
        @update:model-value="emit('color', $event)"
        @clear="emit('clear-color')"
      />

      <span class="ue-tb-divider" />

      <button
        v-for="block in BLOCKS"
        :key="block.name"
        type="button"
        class="ue-tb-btn"
        :class="{ 'is-active': editor.isActive(block.name) }"
        :title="t(block.label)"
        @click="toggleBlock(block.name)"
      >
        <UeIcon :name="block.icon" />
      </button>

      <span class="ue-tb-divider" />

      <button
        type="button"
        class="ue-tb-btn"
        :class="{ 'is-active': editor.isActive('link') }"
        :title="t('toolbar.link')"
        @click="emit('link')"
      >
        <UeIcon name="link" />
      </button>

      <button type="button" class="ue-tb-btn" :title="t('toolbar.image')" @click="emit('image')">
        <UeIcon name="image" />
      </button>

      <UeGridPicker
        icon="columns"
        :title="t('toolbar.columns')"
        :cols="MAX_COLUMNS"
        :disabled="editor.isActive('column') || editor.isActive('columnBlock')"
        :hint="({ cols }) => t('columns.pick', { n: cols })"
        @pick="insertColumns"
      />

      <UeGridPicker
        icon="table"
        :title="t('toolbar.table')"
        :rows="6"
        :cols="6"
        :disabled="editor.isActive('table')"
        :hint="({ rows, cols }) => t('table.pick', { rows, cols })"
        @pick="insertTable"
      />

      <button
        type="button"
        class="ue-tb-btn"
        :title="t('toolbar.hr')"
        @click="editor.chain().focus().setHorizontalRule().run()"
      >
        <UeIcon name="hr" />
      </button>

      <button
        type="button"
        class="ue-tb-btn"
        :title="t('toolbar.clear')"
        @click="editor.chain().focus().unsetAllMarks().clearNodes().run()"
      >
        <UeIcon name="clear" />
      </button>

      <span class="ue-tb-divider" />

      <button
        type="button"
        class="ue-tb-btn"
        :title="t('toolbar.undo')"
        :disabled="!editor.can().undo()"
        @click="editor.chain().focus().undo().run()"
      >
        <UeIcon name="undo" />
      </button>

      <button
        type="button"
        class="ue-tb-btn"
        :title="t('toolbar.redo')"
        :disabled="!editor.can().redo()"
        @click="editor.chain().focus().redo().run()"
      >
        <UeIcon name="redo" />
      </button>

      <template v-if="hasMarkdown">
        <span class="ue-tb-divider" />
        <button
          type="button"
          class="ue-tb-btn"
          :title="t('toolbar.markdown')"
          :aria-pressed="false"
          @click="emit('toggle-source')"
        >
          <UeIcon name="markdown" />
        </button>
      </template>

      <template v-if="hasAI">
        <span class="ue-tb-divider" />
        <button
          type="button"
          class="ue-tb-btn ue-tb-btn--ai"
          :title="t('toolbar.ai')"
          @click="emit('ai')"
        >
          <UeIcon name="ai" />
          {{ t('toolbar.ai') }}
        </button>
      </template>
    </template>
  </div>
</template>
