import { createLowlight } from 'lowlight';
import { createUltraKitWithLowlight, type UltraKitOptions } from './kit-base';

export { VERSION } from './version';

export { createLowlight } from 'lowlight';

export { StarterKit } from '@tiptap/starter-kit';
export { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
export { TextStyle } from '@tiptap/extension-text-style';
export { Color } from '@tiptap/extension-color';
export { Editor, Extension, Mark, Node } from '@tiptap/core';
export type { Editor as TiptapEditor, Extensions, JSONContent, Range } from '@tiptap/core';

export * from './extensions';
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
  DEFAULT_IMAGE_PROCESSING_LIMITS,
  type ImageTransform,
  type ImageProcessingLimits
} from './utils/image';
export type { LowlightInstance, UltraKitAIOptions, UltraKitOptions } from './kit-base';

/** Lean preset with no bundled languages; pass a custom lowlight to add only what you use. */
export function createLeanUltraKit(options: UltraKitOptions = {}) {
  return createUltraKitWithLowlight(options, createLowlight);
}

export const createUltraKit = createLeanUltraKit;
