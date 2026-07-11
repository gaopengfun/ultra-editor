export const VERSION = '0.1.0';

/**
 * Tiptap building blocks, re-exported.
 *
 * Beyond convenience, this is what carries Tiptap's command type augmentations
 * (`toggleBold`, `undo`, the table commands…) into anything that imports
 * ultra-editor. Without it, `editor.chain().toggleBold()` type-errors for
 * consumers who never installed `@tiptap/starter-kit` themselves.
 */
export { default as StarterKit } from '@tiptap/starter-kit';
export { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
export { TextStyle } from '@tiptap/extension-text-style';
export { Color } from '@tiptap/extension-color';
export { Editor, Extension, Mark, Node } from '@tiptap/core';
export type { Editor as TiptapEditor, Extensions, JSONContent, Range } from '@tiptap/core';

export * from './extensions';
export * from './kit';
export * from './upload';
export * from './i18n';
export * from './ai';
export { contrastText } from './utils/color';
export { isSafeImageUrl, isSafeLinkUrl } from './utils/url';
export { isBrowser } from './utils/env';
export {
  transformImage,
  rotateImage,
  loadImage,
  canvasToBlob,
  type ImageTransform
} from './utils/image';
