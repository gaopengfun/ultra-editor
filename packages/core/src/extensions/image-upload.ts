import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import {
  DEFAULT_MAX_IMAGE_SIZE,
  DEFAULT_UPLOAD_CONCURRENCY,
  dataUrlUpload,
  formatSize,
  isAcceptedFile,
  resolveUploadConcurrency,
  type OptionSource,
  type UploadHandler
} from '../upload';
import { isBrowser } from '../utils/env';

export type UploadErrorCode = 'too-large' | 'unsupported' | 'failed';

export interface UploadError {
  code: UploadErrorCode;
  file: File | Blob;
  /** Human-readable size / limit, pre-formatted for the message. */
  size: string;
  max: string;
}

export interface ImageUploadOptions {
  upload: UploadHandler;
  maxSize: OptionSource<number>;
  concurrency: OptionSource<number>;
  accept: string[];
  onError?: (error: UploadError) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageUpload: {
      /** Upload files and insert them as images at the current selection. */
      uploadImages: (files: File[] | FileList) => ReturnType;
    };
  }
}

interface PlaceholderMeta {
  add?: Array<{ id: symbol; pos: number; side: number }>;
  remove?: symbol;
}

const uploadKey = new PluginKey<DecorationSet>('ueImageUpload');

function placeholderWidget(): HTMLElement {
  const element = document.createElement('span');
  element.className = 'ue-upload-placeholder';
  element.setAttribute('contenteditable', 'false');
  return element;
}

/** Where a given placeholder currently sits, or null if it's been removed. */
function placeholderPos(view: EditorView, id: symbol): number | null {
  const decorations = uploadKey.getState(view.state);
  const found = decorations?.find(undefined, undefined, (spec) => spec.id === id);
  return found?.length ? found[0].from : null;
}

const isImage = (file: File) => file.type.startsWith('image/');

function imagesFromClipboard(items: DataTransferItemList | undefined): File[] {
  if (!items) return [];
  return Array.from(items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file && isImage(file));
}

function imagesFromFileList(list: FileList | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter(isImage);
}

/**
 * Paste and drag-drop image upload with an inline placeholder.
 *
 * The placeholder is a decoration, not a node, so an upload that fails or gets
 * abandoned leaves no debris in the document and never enters the undo history.
 */
export const ImageUpload = Extension.create<ImageUploadOptions>({
  name: 'imageUpload',

  addOptions() {
    return {
      upload: dataUrlUpload,
      maxSize: DEFAULT_MAX_IMAGE_SIZE,
      concurrency: DEFAULT_UPLOAD_CONCURRENCY,
      accept: ['image/'],
      onError: undefined
    };
  },

  addCommands() {
    return {
      uploadImages:
        (files) =>
        ({ editor, tr, dispatch }) => {
          const list = Array.from(files as File[]);
          if (!list.length) return false;
          if (!editor.isEditable) return false;
          // `dispatch` is undefined during a `can()` probe. Uploading there would
          // fire real network requests just to answer "is this possible?".
          if (!dispatch) return true;

          // Placeholders are dispatched straight to the view (each upload resolves
          // on its own schedule). Tiptap would otherwise follow up by dispatching
          // the transaction it prepared from the pre-placeholder state, which
          // ProseMirror rejects: "Applying a mismatched transaction".
          tr.setMeta('preventDispatch', true);

          const { view } = editor;
          startUploads(view, list, this.options, view.state.selection.from);
          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin<DecorationSet>({
        key: uploadKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(uploadKey) as PlaceholderMeta | undefined;
            if (meta?.add && isBrowser()) {
              const missing = meta.add.filter(
                ({ id }) => !next.find(undefined, undefined, (spec) => spec.id === id).length
              );
              next = next.add(
                tr.doc,
                missing.map(({ id, pos, side }) =>
                  Decoration.widget(pos, placeholderWidget(), { id, side })
                )
              );
            }
            if (meta?.remove) {
              next = next.remove(
                next.find(undefined, undefined, (spec) => spec.id === meta.remove)
              );
            }
            return next;
          }
        },
        props: {
          decorations: (state) => uploadKey.getState(state),

          handlePaste(view, event) {
            if (!view.editable) return false;
            const files = imagesFromClipboard(event.clipboardData?.items);
            if (!files.length) return false;
            event.preventDefault();
            startUploads(view, files, options, view.state.selection.from);
            return true;
          },

          handleDrop(view, event) {
            if (!view.editable) return false;
            const dragEvent = event as DragEvent;
            const files = imagesFromFileList(dragEvent.dataTransfer?.files);
            if (!files.length) return false;
            event.preventDefault();
            const coords = view.posAtCoords({
              left: dragEvent.clientX,
              top: dragEvent.clientY
            });
            const pos = coords?.pos ?? view.state.selection.from;
            startUploads(view, files, options, pos);
            return true;
          }
        }
      })
    ];
  }
});

function startUploads(
  view: EditorView,
  files: File[],
  options: ImageUploadOptions,
  pos: number
): void {
  const maxSize = typeof options.maxSize === 'function' ? options.maxSize() : options.maxSize;
  const max = formatSize(maxSize);
  const accepted = files.filter((file) => {
    if (!isAcceptedFile(file, options.accept)) {
      options.onError?.({ code: 'unsupported', file, size: formatSize(file.size), max });
      return false;
    }
    if (file.size > maxSize) {
      options.onError?.({ code: 'too-large', file, size: formatSize(file.size), max });
      return false;
    }
    return true;
  });
  if (!accepted.length) return;

  const entries = accepted.map((file, index) => ({
    file,
    id: Symbol('ue-upload'),
    side: index + 1
  }));
  view.dispatch(
    view.state.tr.setMeta(uploadKey, {
      add: entries.map(({ id, side }) => ({ id, pos, side }))
    } satisfies PlaceholderMeta)
  );

  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++];
      await finishUpload(view, entry.file, entry.id, options, max);
    }
  };
  const concurrency = Math.min(resolveUploadConcurrency(options.concurrency), entries.length);
  void Promise.all(Array.from({ length: concurrency }, () => worker()));
}

async function finishUpload(
  view: EditorView,
  file: File,
  id: symbol,
  options: ImageUploadOptions,
  max: string
): Promise<void> {
  let url: string | null = null;
  try {
    url = await options.upload(file, file.name);
  } catch {
    // Reported after the destroyed-view guard below.
  }

  if (view.isDestroyed) return;
  if (url === null) {
    options.onError?.({ code: 'failed', file, size: formatSize(file.size), max });
  }

  const at = placeholderPos(view, id);
  let tr = view.state.tr;
  if (at == null || url === null) {
    view.dispatch(tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta));
    return;
  }
  const node = view.state.schema.nodes.image.create({ src: url, alt: file.name || null });
  const siblings = (uploadKey.getState(view.state) as DecorationSet).find(
    undefined,
    undefined,
    (spec) => spec.id !== id
  );
  tr = tr.replaceWith(at, at, node);
  const add = siblings.map((decoration) => ({
    id: decoration.spec.id as symbol,
    pos: tr.mapping.map(decoration.from, 1),
    side: decoration.spec.side as number
  }));
  view.dispatch(tr.setMeta(uploadKey, { remove: id, add } satisfies PlaceholderMeta));
}
