<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, toRef, watch } from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import {
  createTranslator,
  createUltraKit,
  isSafeLinkUrl,
  resolveUploadOptions,
  rotateImage,
  type AITask,
  type ImageAlign,
  type SlashItem,
  type UploadError
} from '@ultra-editor/core';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

import UeToolbar from './components/UeToolbar.vue';
import UeImageMenu from './components/UeImageMenu.vue';
import UeTableMenu from './components/UeTableMenu.vue';
import UeCropper from './components/UeCropper.vue';
import UePrompt from './components/UePrompt.vue';
import UeToasts from './components/UeToasts.vue';
import UeSlashMenu from './components/UeSlashMenu.vue';
import UeBubbleMenu from './components/UeBubbleMenu.vue';
import UeAiPanel from './components/UeAiPanel.vue';

import { usePrompt } from './composables/usePrompt';
import { useToasts } from './composables/useToasts';
import { useAi } from './composables/useAi';
import type { TableAction, UltraEditorProps } from './types';

const props = withDefaults(defineProps<UltraEditorProps>(), {
  modelValue: '',
  editable: true,
  autofocus: false,
  locale: 'zh-CN',
  toolbar: true,
  statusbar: true,
  debounce: 0
});

const emit = defineEmits<{
  (e: 'update:modelValue', html: string): void;
  (e: 'change', html: string): void;
  (e: 'upload-error', error: UploadError): void;
}>();

const t = computed(() => createTranslator(props.locale, props.messages));
const translate = computed(() => t.value);

const toasts = useToasts();
const prompt = usePrompt();

const upload = computed(() =>
  resolveUploadOptions({
    upload: props.upload,
    fetchImage: props.fetchImage,
    maxSize: props.maxImageSize
  })
);

const provider = computed(() => props.ai?.provider ?? null);
const hasAI = computed(() => !!provider.value);

/* Slash menu ---------------------------------------------------------------- */

const slash = reactive({
  visible: false,
  items: [] as SlashItem[],
  index: 0,
  x: 0,
  y: 0,
  command: null as ((item: SlashItem) => void) | null
});

function placeSlash(rect: DOMRect | null | undefined) {
  if (!rect) return;
  slash.x = Math.min(rect.left, window.innerWidth - 280);
  slash.y = Math.min(rect.bottom + 6, window.innerHeight - 320);
}

const slashRender = () => ({
  onStart: (suggestion: SuggestionProps<SlashItem>) => {
    slash.items = suggestion.items;
    slash.index = 0;
    slash.command = (item: SlashItem) => suggestion.command(item);
    placeSlash(suggestion.clientRect?.());
    slash.visible = true;
  },
  onUpdate: (suggestion: SuggestionProps<SlashItem>) => {
    slash.items = suggestion.items;
    slash.index = 0;
    slash.command = (item: SlashItem) => suggestion.command(item);
    placeSlash(suggestion.clientRect?.());
  },
  onKeyDown: ({ event }: SuggestionKeyDownProps) => {
    if (!slash.visible || !slash.items.length) return false;
    if (event.key === 'ArrowDown') {
      slash.index = (slash.index + 1) % slash.items.length;
      return true;
    }
    if (event.key === 'ArrowUp') {
      slash.index = (slash.index - 1 + slash.items.length) % slash.items.length;
      return true;
    }
    if (event.key === 'Enter') {
      slash.command?.(slash.items[slash.index]);
      return true;
    }
    if (event.key === 'Escape') {
      slash.visible = false;
      return true;
    }
    return false;
  },
  onExit: () => {
    slash.visible = false;
    slash.command = null;
  }
});

/* Editor -------------------------------------------------------------------- */

const editor = useEditor({
  content: props.modelValue,
  editable: props.editable,
  autofocus: props.autofocus,
  extensions: createUltraKit({
    placeholder: props.placeholder,
    locale: props.locale,
    messages: props.messages,
    upload: {
      upload: props.upload,
      fetchImage: props.fetchImage,
      maxSize: props.maxImageSize
    },
    onUploadError: (error) => {
      emit('upload-error', error);
      const message =
        error.code === 'too-large'
          ? t.value('image.tooLarge', { size: error.size, max: error.max })
          : error.code === 'unsupported'
            ? t.value('image.unsupported')
            : t.value('image.uploadFailed');
      toasts.error(message);
    },
    ai: hasAI.value
      ? {
          provider: provider.value,
          slash:
            props.ai?.slash === false
              ? { enabled: false }
              : {
                  enabled: true,
                  items: props.ai?.slashItems,
                  onAI: (task) => ai.start(task),
                  labelOf: (item) => t.value(item.labelKey),
                  render: slashRender
                },
          ghostText: {
            enabled: props.ai?.ghostText === true,
            delay: props.ai?.ghostDelay,
            hint: t.value('ai.ghostHint')
          }
        }
      : undefined
  }),
  editorProps: {
    attributes: {
      class: 'ue-content ue-editor__content'
    },
    handleDOMEvents: {
      // Right-click on an image opens the image menu, on a cell the table menu.
      // Everything else keeps the browser's own context menu.
      contextmenu: (view, event) => {
        const mouse = event as MouseEvent;
        const pos = imagePosAt(view, mouse);
        if (pos != null) {
          mouse.preventDefault();
          editor.value?.chain().setNodeSelection(pos).run();
          openImageMenu(mouse);
          return true;
        }
        return openTableMenuAt(view, mouse);
      }
    }
  },
  onUpdate: ({ editor: instance }) => {
    scheduleEmit(instance.getHTML());
  }
});

const ai = useAi(editor, provider, translate.value, toRef(props, 'locale'));

/* Two-way binding ------------------------------------------------------------ */

// Track what we last emitted so the incoming-prop watcher can tell "the parent
// echoed our own value back" (ignore) from "the parent set new content" (apply).
let lastEmitted = props.modelValue;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleEmit(html: string) {
  lastEmitted = html;
  if (!props.debounce) {
    emit('update:modelValue', html);
    emit('change', html);
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    emit('update:modelValue', html);
    emit('change', html);
  }, props.debounce);
}

watch(
  () => props.modelValue,
  (value) => {
    const instance = editor.value;
    if (!instance || value === lastEmitted) return;
    if (value === instance.getHTML()) return;
    // `emitUpdate: false` stops the round trip; preserving the selection keeps the
    // caret where the author left it when a parent re-hydrates the model.
    instance.commands.setContent(value || '', { emitUpdate: false });
  }
);

watch(
  () => props.editable,
  (value) => editor.value?.setEditable(value)
);

onBeforeUnmount(() => {
  clearTimeout(debounceTimer);
  editor.value?.destroy();
});

/* Word count ----------------------------------------------------------------- */

const stats = computed(() => {
  const text = editor.value?.getText() ?? '';
  const chars = text.replace(/\s/g, '').length;
  // CJK has no spaces; counting characters and Latin words separately is the
  // only count that isn't wrong for one of the two.
  const cjk = (text.match(/[一-龥]/g) ?? []).length;
  const words = (text.replace(/[一-龥]/g, ' ').match(/[A-Za-z0-9']+/g) ?? []).length;
  return { chars, words: cjk + words };
});

/* Text colour ---------------------------------------------------------------- */

const currentColor = ref<string | null>('#51a5dc');

const setColor = (color: string) => {
  currentColor.value = color;
  editor.value?.chain().focus().setColor(color).run();
};

const clearColor = () => {
  currentColor.value = null;
  editor.value?.chain().focus().unsetColor().run();
};

/* Link ----------------------------------------------------------------------- */

async function setLink() {
  const instance = editor.value;
  if (!instance) return;

  const previous = (instance.getAttributes('link').href as string) ?? '';
  const value = await prompt.open({
    title: t.value('link.title'),
    label: t.value('link.label'),
    placeholder: t.value('link.placeholder'),
    value: previous,
    validate: (input) =>
      !input || (/^https?:\/\//i.test(input) && isSafeLinkUrl(input))
        ? null
        : t.value('link.invalid')
  });

  if (value === null) return;
  if (!value) {
    instance.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  instance.chain().focus().extendMarkRange('link').setLink({ href: value }).run();
}

/* Image ---------------------------------------------------------------------- */

const fileInput = ref<HTMLInputElement>();

const pickImage = () => fileInput.value?.click();

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files;
  input.value = '';
  if (files?.length) editor.value?.commands.uploadImages(files);
}

function imagePosAt(view: EditorView, event: MouseEvent): number | null {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (found && found.inside >= 0) {
    const node = view.state.doc.nodeAt(found.inside);
    if (node?.type.name === 'image') return found.inside;
  }

  const img = (event.target as HTMLElement)?.closest?.('img');
  if (!img) return null;
  try {
    const domPos = view.posAtDOM(img, 0);
    for (const candidate of [domPos, domPos - 1]) {
      if (candidate >= 0 && view.state.doc.nodeAt(candidate)?.type.name === 'image') {
        return candidate;
      }
    }
  } catch {
    // posAtDOM throws on some DOM shapes; falling through is the right answer.
  }
  return null;
}

const imageMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  align: null as ImageAlign | null,
  hasCaption: false
});

const rotating = ref(false);

function openImageMenu(event: MouseEvent) {
  const attrs = editor.value?.getAttributes('image') ?? {};
  imageMenu.align = (attrs.align as ImageAlign) ?? null;
  imageMenu.hasCaption = !!attrs.caption;
  imageMenu.x = event.clientX;
  imageMenu.y = event.clientY;
  imageMenu.visible = true;
}

/**
 * The selected image, resolved from live editor state rather than a position
 * cached when the menu opened — the document can change underneath an open menu.
 */
function selectedImage(): { pos: number; attrs: Record<string, unknown> } | null {
  const instance = editor.value;
  if (!instance) return null;
  const { from } = instance.state.selection;
  const node = instance.state.doc.nodeAt(from);
  if (node?.type.name !== 'image') return null;
  return { pos: from, attrs: node.attrs };
}

function updateImage(patch: Record<string, unknown>) {
  const target = selectedImage();
  if (!target) return;
  editor.value
    ?.chain()
    .focus()
    .setNodeSelection(target.pos)
    .updateAttributes('image', patch)
    .run();
}

const setAlign = (align: ImageAlign) => updateImage({ align });

async function setCaption() {
  const target = selectedImage();
  if (!target) return;

  const value = await prompt.open({
    title: t.value('image.captionTitle'),
    label: t.value('image.captionLabel'),
    value: (target.attrs.caption as string) ?? ''
  });
  if (value === null) return;
  updateImage({ caption: value || null, alt: value || null });
}

async function rotate(degrees: 90 | -90) {
  if (rotating.value) return;
  const target = selectedImage();
  const src = target?.attrs.src as string | undefined;
  if (!src) return;

  rotating.value = true;
  const notice = toasts.loading(t.value('image.rotating'));
  try {
    const blob = await rotateImage(src, degrees, upload.value.fetchImage);
    if (blob.size > upload.value.maxSize) throw new Error('too-large');

    const url = await upload.value.upload(blob, 'rotate.png');
    updateImage({ src: url, width: null, height: null });
    toasts.success(t.value('image.rotated'));
  } catch {
    toasts.error(t.value('image.rotateFailed'));
  } finally {
    toasts.dismiss(notice);
    rotating.value = false;
  }
}

const cropper = reactive({ visible: false, src: '' });

function openCropper() {
  const target = selectedImage();
  const src = target?.attrs.src as string | undefined;
  if (!src) return;
  cropper.src = src;
  cropper.visible = true;
}

async function onCropped(blob: Blob) {
  const notice = toasts.loading(t.value('image.uploading'));
  try {
    if (blob.size > upload.value.maxSize) throw new Error('too-large');
    const url = await upload.value.upload(blob, 'crop.png');
    updateImage({ src: url, width: null, height: null });
  } catch {
    toasts.error(t.value('image.uploadFailed'));
  } finally {
    toasts.dismiss(notice);
  }
}

/* Table ---------------------------------------------------------------------- */

const tableMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  canMerge: false,
  canSplit: false,
  cellColor: null as string | null
});

function openTableMenuAt(view: EditorView, event: MouseEvent): boolean {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return false;

  const $pos = view.state.doc.resolve(coords.pos);
  let inTable = false;
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'table') {
      inTable = true;
      break;
    }
  }
  if (!inTable) return false;

  event.preventDefault();
  // Keep an existing multi-cell selection so "merge" still has something to merge.
  if (!(view.state.selection instanceof CellSelection)) {
    editor.value?.chain().setTextSelection(coords.pos).run();
  }

  const instance = editor.value;
  tableMenu.canMerge = instance?.can().mergeCells() ?? false;
  tableMenu.canSplit = instance?.can().splitCell() ?? false;
  tableMenu.cellColor =
    (instance?.getAttributes('tableHeader').backgroundColor as string | null) ??
    (instance?.getAttributes('tableCell').backgroundColor as string | null) ??
    null;
  tableMenu.x = event.clientX;
  tableMenu.y = event.clientY;
  tableMenu.visible = true;
  return true;
}

function runTableAction(action: TableAction) {
  const chain = editor.value?.chain().focus();
  if (!chain) return;
  const actions: Record<TableAction, () => void> = {
    rowBefore: () => chain.addRowBefore().run(),
    rowAfter: () => chain.addRowAfter().run(),
    colBefore: () => chain.addColumnBefore().run(),
    colAfter: () => chain.addColumnAfter().run(),
    delRow: () => chain.deleteRow().run(),
    delCol: () => chain.deleteColumn().run(),
    merge: () => chain.mergeCells().run(),
    split: () => chain.splitCell().run(),
    headerRow: () => chain.toggleHeaderRow().run(),
    headerCol: () => chain.toggleHeaderColumn().run(),
    delTable: () => chain.deleteTable().run()
  };
  actions[action]();
}

const setCellColor = (color: string) =>
  editor.value?.chain().focus().setCellAttribute('backgroundColor', color).run();

const clearCellColor = () =>
  editor.value?.chain().focus().setCellAttribute('backgroundColor', null).run();

/* Slash selection ------------------------------------------------------------ */

function onSlashSelect(item: SlashItem) {
  slash.command?.(item);
  slash.visible = false;
}

/* Public API ----------------------------------------------------------------- */

defineExpose({
  /** The underlying Tiptap instance — an escape hatch for anything not exposed here. */
  editor,
  getHTML: () => editor.value?.getHTML() ?? '',
  getText: () => editor.value?.getText() ?? '',
  getJSON: () => editor.value?.getJSON(),
  setContent: (html: string) => editor.value?.commands.setContent(html || ''),
  focus: () => editor.value?.commands.focus(),
  clear: () => editor.value?.commands.clearContent(true),
  runAI: (task: AITask) => ai.start(task)
});
</script>

<template>
  <div
    class="ultra-editor"
    :class="{ 'ultra-editor--readonly': !editable }"
    :style="{ '--ue-min-height': minHeight, '--ue-max-height': maxHeight }"
  >
    <UeToolbar
      v-if="editor && toolbar && editable"
      :editor="editor"
      :color="currentColor"
      :has-a-i="hasAI"
      :t="t"
      @color="setColor"
      @clear-color="clearColor"
      @link="setLink"
      @image="pickImage"
      @ai="ai.start('continue')"
    />

    <EditorContent class="ue-editor" :editor="editor" />

    <div v-if="statusbar && editor" class="ue-statusbar">
      <span>{{ t('stats.words', { n: stats.words }) }}</span>
      <span>{{ t('stats.chars', { n: stats.chars }) }}</span>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      hidden
      @change="onFilePicked"
    />

    <UeImageMenu
      :visible="imageMenu.visible"
      :x="imageMenu.x"
      :y="imageMenu.y"
      :align="imageMenu.align"
      :has-caption="imageMenu.hasCaption"
      :t="t"
      @rotate="rotate"
      @crop="openCropper"
      @align="setAlign"
      @caption="setCaption"
      @close="imageMenu.visible = false"
    />

    <UeTableMenu
      :visible="tableMenu.visible"
      :x="tableMenu.x"
      :y="tableMenu.y"
      :can-merge="tableMenu.canMerge"
      :can-split="tableMenu.canSplit"
      :cell-color="tableMenu.cellColor"
      :t="t"
      @action="runTableAction"
      @set-color="setCellColor"
      @clear-color="clearCellColor"
      @close="tableMenu.visible = false"
    />

    <UeCropper
      v-model="cropper.visible"
      :src="cropper.src"
      :fetch-image="upload.fetchImage"
      :t="t"
      @confirm="onCropped"
      @error="toasts.error"
    />

    <UePrompt :controller="prompt" :t="t" />

    <UeSlashMenu
      :visible="slash.visible"
      :x="slash.x"
      :y="slash.y"
      :items="slash.items"
      :index="slash.index"
      :t="t"
      @select="onSlashSelect"
      @hover="slash.index = $event"
    />

    <UeBubbleMenu
      v-if="editor && editable"
      :editor="editor"
      :tasks="props.ai?.tasks ?? ['improve', 'translate', 'summarize', 'rewrite', 'expand', 'shorten', 'fixGrammar', 'changeTone', 'custom']"
      :has-a-i="hasAI"
      :t="t"
      @ai="ai.start"
    />

    <UeAiPanel :controller="ai" :t="t" />

    <UeToasts :toasts="toasts.toasts.value" />
  </div>
</template>
