import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import {
  DEFAULT_MAX_IMAGE_SIZE,
  dataUrlUpload,
  formatSize,
  isAcceptedFile,
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
  maxSize: number;
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
  add?: { id: symbol; pos: number };
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
          // `dispatch` is undefined during a `can()` probe. Uploading there would
          // fire real network requests just to answer "is this possible?".
          if (!dispatch) return true;

          // Placeholders are dispatched straight to the view (each upload resolves
          // on its own schedule). Tiptap would otherwise follow up by dispatching
          // the transaction it prepared from the pre-placeholder state, which
          // ProseMirror rejects: "Applying a mismatched transaction".
          tr.setMeta('preventDispatch', true);

          const { view } = editor;
          list.forEach((file) => startUpload(view, file, this.options, view.state.selection.from));
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
              next = next.add(tr.doc, [
                Decoration.widget(meta.add.pos, placeholderWidget(), { id: meta.add.id })
              ]);
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
            const files = imagesFromClipboard(event.clipboardData?.items);
            if (!files.length) return false;
            event.preventDefault();
            files.forEach((file) => startUpload(view, file, options, view.state.selection.from));
            return true;
          },

          handleDrop(view, event) {
            const dragEvent = event as DragEvent;
            const files = imagesFromFileList(dragEvent.dataTransfer?.files);
            if (!files.length) return false;
            event.preventDefault();
            const coords = view.posAtCoords({
              left: dragEvent.clientX,
              top: dragEvent.clientY
            });
            const pos = coords?.pos ?? view.state.selection.from;
            files.forEach((file) => startUpload(view, file, options, pos));
            return true;
          }
        }
      })
    ];
  }
});

function startUpload(view: EditorView, file: File, options: ImageUploadOptions, pos: number): void {
  const max = formatSize(options.maxSize);

  if (!isAcceptedFile(file, options.accept)) {
    options.onError?.({ code: 'unsupported', file, size: formatSize(file.size), max });
    return;
  }
  if (file.size > options.maxSize) {
    options.onError?.({ code: 'too-large', file, size: formatSize(file.size), max });
    return;
  }

  const id = Symbol('ue-upload');
  view.dispatch(view.state.tr.setMeta(uploadKey, { add: { id, pos } } satisfies PlaceholderMeta));

  options
    .upload(file, file.name)
    .then((url) => {
      // The editor can be torn down while the upload is in flight; dispatching
      // into a destroyed view throws. Abandon the result quietly.
      if (view.isDestroyed) return;
      const at = placeholderPos(view, id);
      const tr = view.state.tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta);
      // The placeholder is gone (user undid, or deleted the paragraph) — drop the
      // result rather than parachuting an image into wherever the cursor now is.
      if (at == null) {
        view.dispatch(tr);
        return;
      }
      const node = view.state.schema.nodes.image.create({ src: url, alt: file.name || null });
      view.dispatch(tr.replaceWith(at, at, node));
    })
    .catch(() => {
      if (view.isDestroyed) return;
      view.dispatch(view.state.tr.setMeta(uploadKey, { remove: id } satisfies PlaceholderMeta));
      options.onError?.({ code: 'failed', file, size: formatSize(file.size), max });
    });
}
