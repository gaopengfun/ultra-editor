<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  toRef,
  watch
} from 'vue';
import { EditorContent, useEditor } from '@tiptap/vue-3';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import {
  createLowlight,
  createTranslator,
  createLeanUltraKit,
  DEFAULT_SLASH_ITEMS,
  docToMarkdown,
  isAIStreamTransaction,
  isSafeLinkUrl,
  loadCommonLanguages,
  markdownToHTML,
  refreshCodeHighlighting,
  resolveUploadOptions,
  rotateImage,
  ULTRA_EDITOR_OPTIONS_META,
  type AITask,
  type ImageAlign,
  type SlashGroup,
  type SlashItem,
  type UploadError
} from '@ultra-editor/core/lean';
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

import UeToolbar from './components/UeToolbar.vue';
import UeImageMenu from './components/UeImageMenu.vue';
import UeTableMenu from './components/UeTableMenu.vue';
import UePrompt from './components/UePrompt.vue';
import UeToasts from './components/UeToasts.vue';
import UeSlashMenu from './components/UeSlashMenu.vue';
import UeBubbleMenu from './components/UeBubbleMenu.vue';
import UeAiPanel from './components/UeAiPanel.vue';

import { usePrompt } from './composables/usePrompt';
import { useToasts } from './composables/useToasts';
import { useAi } from './composables/useAi';
import type { TableAction, UltraEditorProps } from './types';

const loadCropper = () => import('./components/UeCropper.vue');
const UeCropper = defineAsyncComponent(() =>
  loadCropper().then(({ default: component }) => component)
);

const props = withDefaults(defineProps<UltraEditorProps>(), {
  modelValue: '',
  editable: true,
  autofocus: false,
  locale: 'zh-CN',
  toolbar: true,
  statusbar: true,
  // Declared `boolean` props Vue casts to `false` when absent, so every one of
  // them needs its default spelled out here or "not passed" reads as "off".
  markdown: true,
  debounce: 0
});

const emit = defineEmits<{
  (e: 'update:modelValue', html: string): void;
  (e: 'change', html: string): void;
  (e: 'upload-error', error: UploadError): void;
}>();

const t = computed(() => createTranslator(props.locale, props.messages));

const toasts = useToasts();
const prompt = usePrompt();

const upload = computed(() =>
  resolveUploadOptions({
    upload: props.upload,
    fetchImage: props.fetchImage,
    maxSize: props.maxImageSize,
    concurrency: props.uploadConcurrency
  })
);

const provider = computed(() => props.ai?.provider ?? null);
const hasAI = computed(() => !!provider.value);

/* Syntax highlighting -------------------------------------------------------- */

// A host that passes `lowlight` owns the language set outright — we neither add
// to it nor fetch anything. Without one the editor starts with an empty registry
// and pulls lowlight's common grammars in as their own chunk once it is mounted,
// so an app that never shows a code block never downloads 37 syntax parsers,
// while one that does gets a real language picker instead of a lone "plain text".
const lowlight = props.lowlight ?? createLowlight();

onMounted(async () => {
  if (props.lowlight) return;
  await loadCommonLanguages(lowlight);
  const instance = editor.value;
  // The import can outlive the component; a torn-down editor has nothing to paint.
  if (instance && !instance.isDestroyed) refreshCodeHighlighting(instance);
});

/* Markdown ------------------------------------------------------------------- */

/**
 * Source mode: the document becomes the Markdown that describes it, in a plain
 * textarea, and comes back when the author leaves.
 *
 * The textarea is the source of truth while it is open — the document is only
 * ever written *from* it, never back into it. Re-deriving the text from the
 * document on each keystroke would reformat what the author is halfway through
 * typing, which is the one thing a source view must never do.
 */
const sourceMode = ref(false);
const source = ref('');
const sourceInput = ref<HTMLTextAreaElement>();

function applySource() {
  const instance = editor.value;
  /* v8 ignore next */
  if (!instance) return;
  const html = markdownToHTML(source.value);
  if (html === instance.getHTML()) return;
  instance.commands.setContent(html);
}

function toggleSourceMode() {
  const instance = editor.value;
  /* v8 ignore next */
  if (!instance) return;
  // A debounced apply describes markdown that is about to stop being the source of
  // truth. Left running, it lands after the author is back in the document and
  // overwrites everything they have typed since — the exit path applies the
  // textarea itself, so the pending timer has nothing left to contribute.
  clearTimeout(sourceTimer);
  if (sourceMode.value) {
    applySource();
    sourceMode.value = false;
    instance.commands.focus();
    return;
  }
  // A pending debounced emit describes the document the author is leaving; let it
  // out before the textarea takes over as the thing being edited.
  flushEmit();
  source.value = docToMarkdown(instance.state.doc);
  sourceMode.value = true;
  void nextTick(() => sourceInput.value?.focus());
}

// Applying on every keystroke keeps `v-model` honest while source mode is open —
// a host reading the model mid-edit gets the document the Markdown describes,
// not the one from before the author switched.
let sourceTimer: ReturnType<typeof setTimeout> | undefined;
const SOURCE_APPLY_DELAY = 300;

function onSourceInput() {
  clearTimeout(sourceTimer);
  sourceTimer = setTimeout(applySource, props.debounce || SOURCE_APPLY_DELAY);
}

/* Slash menu ---------------------------------------------------------------- */

const slash = reactive({
  visible: false,
  items: [] as SlashItem[],
  index: 0,
  x: 0,
  y: 0,
  command: null as ((item: SlashItem) => void) | null
});

const GROUP_ORDER: SlashGroup[] = ['basic', 'insert', 'ai'];

/**
 * Group the items once, here, and let the menu render the result in order.
 *
 * The keyboard handler indexes into this array, so it has to be the same array the
 * menu paints — if the menu did its own grouping, Enter would fire whichever item
 * happened to sit at that index in the *unsorted* list, not the highlighted one.
 */
function orderSlashItems(items: SlashItem[]): SlashItem[] {
  return GROUP_ORDER.flatMap((group) => items.filter((item) => item.group === group));
}

function placeSlash(rect: DOMRect | null | undefined) {
  if (!rect) return;
  slash.x = Math.min(rect.left, window.innerWidth - 280);
  slash.y = Math.min(rect.bottom + 6, window.innerHeight - 320);
}

// Opening and refiltering do the same work; only opening also raises the menu.
const syncSlash = (suggestion: SuggestionProps<SlashItem>) => {
  slash.items = orderSlashItems(suggestion.items);
  slash.index = 0;
  slash.command = (item: SlashItem) => suggestion.command(item);
  placeSlash(suggestion.clientRect?.());
};

const slashRender = () => ({
  onStart: (suggestion: SuggestionProps<SlashItem>) => {
    syncSlash(suggestion);
    slash.visible = true;
  },
  onUpdate: syncSlash,
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

// Registered before `useEditor`, so a pending debounced value is serialized
// before that composable tears down the ProseMirror schema during unmount.
onBeforeUnmount(() => {
  clearTimeout(sourceTimer);
  // Unmounting from source mode must not throw the author's Markdown away.
  if (sourceMode.value) applySource();
  clearTimeout(debounceTimer);
  flushEmit();
});

const editor = useEditor({
  content: props.modelValue,
  editable: props.editable,
  autofocus: props.autofocus,
  extensions: createLeanUltraKit({
    placeholder: () => props.placeholder ?? t.value('editor.placeholder'),
    locale: props.locale,
    messages: props.messages,
    translator: () => t.value,
    lowlight,
    markdownPaste: () => props.markdown,
    upload: {
      // Delegated through the computed so a handler swapped in after mount is honoured.
      upload: (file, filename) => upload.value.upload(file, filename),
      // No `fetchImage` here on purpose: no core extension reads it. Re-encoding an
      // existing image is chrome, so rotate and the cropper call `upload.fetchImage`
      // off the computed directly — see `rotate()` and the `fetch-image` prop below.
      maxSize: () => upload.value.maxSize,
      concurrency: () => upload.value.concurrency
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
    // Everything dynamic is passed as a getter. The extension list is built once,
    // but the provider may arrive later and the ghost-text toggle can flip at any
    // time — freezing today's values here would make both silently inert.
    ai: {
      provider: () => provider.value,
      slash: {
        enabled: () => props.ai?.slash !== false,
        items: () => props.ai?.slashItems ?? DEFAULT_SLASH_ITEMS,
        onAI: (task) => ai.start(task),
        labelOf: (item) => t.value(item.labelKey),
        hasAI: () => hasAI.value,
        render: slashRender
      },
      ghostText: {
        enabled: () => props.ai?.ghostText === true,
        delay: () => props.ai?.ghostDelay ?? 800,
        locale: () => props.locale,
        hint: () => t.value('ai.ghostHint')
      }
    }
  }),
  editorProps: {
    attributes: {
      class: 'ue-content ue-editor__content'
    },
    handleDOMEvents: {
      // Right-click on an image opens the image menu, on a cell the table menu.
      // Everything else keeps the browser's own context menu.
      contextmenu: (view, event) => {
        if (!view.editable) return false;
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
  onUpdate: ({ transaction }) => {
    // A runtime-options refresh — a locale change, or grammars arriving and
    // forcing a repaint — rewrites no content. Emitting there would hand the host
    // a `change` for a document nobody touched, and mark a pristine draft dirty.
    if (transaction.getMeta(ULTRA_EDITOR_OPTIONS_META)) return;
    if (transaction.docChanged && !isAIStreamTransaction(transaction)) scheduleEmit();
  }
});

// `t` is passed as the ref, not its current value: the AI panel's strings have to
// follow a locale change like every other component's do.
const ai = useAi(editor, provider, t, toRef(props, 'locale'), () => props.editable);

watch(t, () => {
  const instance = editor.value;
  /* v8 ignore else -- Vue stops this watcher before useEditor destroys the instance */
  if (instance && !instance.isDestroyed) {
    instance.view.dispatch(instance.state.tr.setMeta(ULTRA_EDITOR_OPTIONS_META, true));
  }
});

/* Two-way binding ------------------------------------------------------------ */

// Track what we last emitted so the incoming-prop watcher can tell "the parent
// echoed our own value back" (ignore) from "the parent set new content" (apply).
let lastEmitted = props.modelValue;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

function flushEmit() {
  if (!pending) return;
  const instance = editor.value;
  /* v8 ignore next -- this hook is registered before useEditor tears the instance down */
  if (!instance) return;
  pending = false;
  const html = instance.getHTML();
  lastEmitted = html;
  emit('update:modelValue', html);
  emit('change', html);
}

function scheduleEmit() {
  pending = true;
  if (!props.debounce) {
    flushEmit();
    return;
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushEmit, props.debounce);
}

function cancelPendingEmit() {
  clearTimeout(debounceTimer);
  debounceTimer = undefined;
  pending = false;
}

watch(
  () => props.modelValue,
  (value) => {
    const instance = editor.value;
    if (!instance || value === lastEmitted) return;
    cancelPendingEmit();
    lastEmitted = value;
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

/* Word count ----------------------------------------------------------------- */

const stats = computed(() => {
  /* v8 ignore next */
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
  /* v8 ignore next */
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
  // Copy the files out BEFORE resetting the input. `input.files` is a live
  // FileList that `input.value = ''` empties in place — holding the reference
  // across the reset yields an empty list and the upload silently never happens.
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length) editor.value?.commands.uploadImages(files);
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
  void loadCropper();
  /* v8 ignore next */
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
  /* v8 ignore next */
  if (!instance || !instance.isEditable) return null;
  const { from } = instance.state.selection;
  const node = instance.state.doc.nodeAt(from);
  if (node?.type.name !== 'image') return null;
  return { pos: from, attrs: node.attrs };
}

interface TrackedImage {
  src: string;
  update: (patch: Record<string, unknown>) => boolean;
  stop: () => void;
}

function trackSelectedImage(): TrackedImage | null {
  const instance = editor.value;
  const selected = selectedImage();
  const src = selected?.attrs.src;
  if (!instance || !selected || typeof src !== 'string') return null;

  let pos = selected.pos;
  let valid = true;
  const follow = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
    if (!transaction.docChanged) return;
    const mapped = transaction.mapping.mapResult(pos, 1);
    pos = mapped.pos;
    if (mapped.deleted) valid = false;
  };
  instance.on('transaction', follow);

  const stop = () => instance.off('transaction', follow);
  return {
    src,
    stop,
    update(patch) {
      const node = instance.state.doc.nodeAt(pos);
      if (
        !valid ||
        instance.isDestroyed ||
        !instance.isEditable ||
        node?.type.name !== 'image' ||
        node.attrs.src !== src
      ) {
        return false;
      }
      return instance.chain().focus().setNodeSelection(pos).updateAttributes('image', patch).run();
    }
  };
}

function updateImage(patch: Record<string, unknown>) {
  const target = selectedImage();
  if (!target) return;
  editor.value?.chain().focus().setNodeSelection(target.pos).updateAttributes('image', patch).run();
}

const setAlign = (align: ImageAlign) => updateImage({ align });

async function setCaption() {
  const target = trackSelectedImage();
  if (!target) return;
  try {
    const value = await prompt.open({
      title: t.value('image.captionTitle'),
      label: t.value('image.captionLabel'),
      value: (selectedImage()?.attrs.caption as string) ?? ''
    });
    if (value !== null) target.update({ caption: value || null, alt: value || null });
  } finally {
    target.stop();
  }
}

async function rotate(degrees: 90 | -90) {
  if (rotating.value) return;
  const target = trackSelectedImage();
  if (!target) return;

  rotating.value = true;
  const notice = toasts.loading(t.value('image.rotating'));
  try {
    const blob = await rotateImage(
      target.src,
      degrees,
      upload.value.fetchImage,
      props.imageProcessingLimits
    );
    if (blob.size > upload.value.maxSize) throw new Error('too-large');

    const url = await upload.value.upload(blob, 'rotate.png');
    if (target.update({ src: url, width: null, height: null })) {
      toasts.success(t.value('image.rotated'));
    }
  } catch {
    toasts.error(t.value('image.rotateFailed'));
  } finally {
    toasts.dismiss(notice);
    target.stop();
    rotating.value = false;
  }
}

const cropper = reactive({ visible: false, src: '' });
let cropTarget: TrackedImage | null = null;

function openCropper() {
  cropTarget?.stop();
  cropTarget = trackSelectedImage();
  if (!cropTarget) return;
  cropper.src = cropTarget.src;
  cropper.visible = true;
}

function setCropperVisible(visible: boolean) {
  cropper.visible = visible;
  if (!visible) {
    cropTarget?.stop();
    cropTarget = null;
  }
}

async function onCropped(blob: Blob) {
  const target = cropTarget;
  cropTarget = null;
  const notice = toasts.loading(t.value('image.uploading'));
  try {
    if (blob.size > upload.value.maxSize) throw new Error('too-large');
    const url = await upload.value.upload(blob, 'crop.png');
    target?.update({ src: url, width: null, height: null });
  } catch {
    toasts.error(t.value('image.uploadFailed'));
  } finally {
    toasts.dismiss(notice);
    target?.stop();
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
  /* v8 ignore next */
  tableMenu.canMerge = instance?.can().mergeCells() ?? false;
  /* v8 ignore next */
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
  const instance = editor.value;
  if (!instance?.isEditable) return;
  const chain = instance.chain().focus();
  /* v8 ignore next */
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

const setCellColor = (color: string) => {
  const instance = editor.value;
  if (!instance?.isEditable) return;
  instance.chain().focus().setCellAttribute('backgroundColor', color).run();
};

const clearCellColor = () => {
  const instance = editor.value;
  if (!instance?.isEditable) return;
  instance.chain().focus().setCellAttribute('backgroundColor', null).run();
};

/* Slash selection ------------------------------------------------------------ */

function onSlashSelect(item: SlashItem) {
  slash.command?.(item);
  slash.visible = false;
}

/* Public API ----------------------------------------------------------------- */

defineExpose({
  /** The underlying Tiptap instance — an escape hatch for anything not exposed here. */
  editor,
  /* v8 ignore next */
  getHTML: () => editor.value?.getHTML() ?? '',
  /* v8 ignore next */
  getText: () => editor.value?.getText() ?? '',
  getJSON: () => editor.value?.getJSON(),
  /** The document as Markdown. In source mode, exactly what is in the textarea. */
  getMarkdown: () => {
    if (sourceMode.value) return source.value;
    const instance = editor.value;
    /* v8 ignore next -- the exposed API is only reachable while the editor is mounted */
    if (!instance) return '';
    return docToMarkdown(instance.state.doc);
  },
  setMarkdown: (markdown: string) => {
    if (sourceMode.value) {
      source.value = markdown;
      applySource();
      return;
    }
    editor.value?.commands.setContent(markdownToHTML(markdown));
  },
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
      :has-markdown="markdown"
      :source-mode="sourceMode"
      :t="t"
      @color="setColor"
      @clear-color="clearColor"
      @link="setLink"
      @image="pickImage"
      @ai="ai.start('continue')"
      @toggle-source="toggleSourceMode"
    />

    <textarea
      v-if="sourceMode"
      ref="sourceInput"
      v-model="source"
      class="ue-markdown"
      spellcheck="false"
      :aria-label="t('toolbar.markdown')"
      :placeholder="t('markdown.placeholder')"
      @input="onSourceInput"
    />
    <EditorContent v-show="!sourceMode" class="ue-editor" :editor="editor" />

    <div v-if="statusbar && editor" class="ue-statusbar">
      <span>{{ t('stats.words', { n: stats.words }) }}</span>
      <span>{{ t('stats.chars', { n: stats.chars }) }}</span>
    </div>

    <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="onFilePicked" />

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
      v-if="cropper.visible"
      :model-value="cropper.visible"
      :src="cropper.src"
      :fetch-image="upload.fetchImage"
      :limits="props.imageProcessingLimits"
      :t="t"
      @update:model-value="setCropperVisible"
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
      :tasks="
        props.ai?.tasks ?? [
          'improve',
          'translate',
          'summarize',
          'rewrite',
          'expand',
          'shorten',
          'fixGrammar',
          'changeTone',
          'custom'
        ]
      "
      :has-a-i="hasAI"
      :t="t"
      @ai="ai.start"
    />

    <UeAiPanel :controller="ai" :t="t" />

    <UeToasts :toasts="toasts.toasts.value" />
  </div>
</template>
