import Image from '@tiptap/extension-image';
import { mergeAttributes, ResizableNodeView } from '@tiptap/core';
import type { ResizableNodeViewDirection } from '@tiptap/core';
import { isSafeImageUrl } from '../utils/url';
import { isBrowser } from '../utils/env';

export type ImageAlign = 'left' | 'center' | 'right';

export interface ImageResizeConfig {
  enabled: boolean;
  directions?: ResizableNodeViewDirection[];
  minWidth?: number;
  minHeight?: number;
  alwaysPreserveAspectRatio?: boolean;
}

const JUSTIFY: Record<string, string> = {
  left: 'flex-start',
  center: 'center',
  right: 'flex-end'
};

/**
 * Image with alignment, caption and 8-anchor drag resizing.
 *
 * Alignment and caption are not plain attributes: they are folded into a
 * `<figure>` / `data-align` on render and parsed back out, so the serialised
 * HTML stays semantic instead of carrying editor-only bookkeeping.
 */
export const ImageFigure = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: null,
        renderHTML: () => ({}),
        parseHTML: (el: HTMLElement) => el.getAttribute('data-align') || null
      },
      caption: {
        default: null,
        renderHTML: () => ({}),
        parseHTML: () => null
      }
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const align = node.attrs.align as string | null;
    const caption = node.attrs.caption as string | null;
    const imgAttrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);

    // Last line of defence: a `javascript:` src must never reach the output HTML,
    // no matter how it got into the document (paste, setContent, programmatic).
    const src = imgAttrs.src;
    if (typeof src === 'string' && !isSafeImageUrl(src)) {
      delete imgAttrs.src;
    }

    if (caption) {
      const figureAttrs: Record<string, string> = { class: 'ue-figure' };
      if (align) figureAttrs['data-align'] = align;
      return ['figure', figureAttrs, ['img', imgAttrs], ['figcaption', {}, caption]];
    }
    if (align) {
      return ['img', mergeAttributes(imgAttrs, { 'data-align': align })];
    }
    return ['img', imgAttrs];
  },

  parseHTML() {
    return [
      {
        tag: 'figure.ue-figure, figure.tiptap-figure',
        priority: 60,
        getAttrs: (el) => {
          const figure = el as HTMLElement;
          const img = figure.querySelector('img');
          if (!img) return false;
          const src = img.getAttribute('src');
          if (src && !isSafeImageUrl(src)) return false;
          const figcaption = figure.querySelector('figcaption');
          return {
            src,
            alt: img.getAttribute('alt'),
            title: img.getAttribute('title'),
            width: img.getAttribute('width'),
            height: img.getAttribute('height'),
            align: figure.getAttribute('data-align'),
            caption: figcaption?.textContent || null
          };
        }
      },
      {
        tag: this.options.allowBase64 ? 'img[src]' : 'img[src]:not([src^="data:"])',
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src');
          return src && !isSafeImageUrl(src) ? false : null;
        }
      }
    ];
  },

  addNodeView() {
    const resize = this.options.resize;
    if (!resize || !resize.enabled || !isBrowser()) return null;

    const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = resize;
    const editor = this.editor;
    const extensionName = this.name;
    const optionHTMLAttributes = this.options.HTMLAttributes;

    return ({ node, getPos, HTMLAttributes }) => {
      const el = document.createElement('img');
      el.draggable = false;

      // The node view replaces renderHTML on the editing surface, so the <figcaption>
      // that renderHTML emits never appears while writing. Without this, adding a
      // caption looks like it did nothing — the text only shows up after save.
      const caption = document.createElement('figcaption');
      caption.className = 'ue-figcaption';
      caption.contentEditable = 'false';

      const syncCaption = (value: string | null) => {
        caption.textContent = value ?? '';
        caption.style.display = value ? '' : 'none';
      };
      const merged = mergeAttributes(optionHTMLAttributes, HTMLAttributes);
      Object.entries(merged).forEach(([key, value]) => {
        if (value == null) return;
        if (key === 'width' || key === 'height' || key === 'align' || key === 'caption') return;
        if (key === 'src') return;
        el.setAttribute(key, value as string);
      });
      if (typeof merged.src === 'string' && isSafeImageUrl(merged.src)) el.src = merged.src;

      const nodeView = new ResizableNodeView({
        element: el,
        editor,
        node,
        getPos,
        onResize: (width: number, height: number) => {
          el.style.width = `${width}px`;
          el.style.height = `${height}px`;
        },
        onCommit: (width: number, height: number) => {
          const pos = getPos();
          if (pos === undefined) return;
          editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes(extensionName, { width, height })
            .run();
        },
        onUpdate: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;
          const container = nodeView.dom as HTMLElement;
          container.style.justifyContent = updatedNode.attrs.align
            ? (JUSTIFY[updatedNode.attrs.align] ?? 'flex-start')
            : '';
          const nextSrc = updatedNode.attrs.src;
          if (
            typeof nextSrc === 'string' &&
            isSafeImageUrl(nextSrc) &&
            el.getAttribute('src') !== nextSrc
          ) {
            el.src = nextSrc;
          }
          el.style.width = updatedNode.attrs.width ? `${updatedNode.attrs.width}px` : '';
          el.style.height = updatedNode.attrs.height ? `${updatedNode.attrs.height}px` : '';
          syncCaption(updatedNode.attrs.caption as string | null);
          return true;
        },
        options: {
          directions,
          min: { width: minWidth, height: minHeight },
          preserveAspectRatio: alwaysPreserveAspectRatio === true
        }
      });

      const container = nodeView.dom as HTMLElement;
      container.style.justifyContent = node.attrs.align
        ? (JUSTIFY[node.attrs.align] ?? 'flex-start')
        : '';

      // The resize wrapper lays its children out in a row; letting it wrap and
      // giving the caption a full-width basis drops it onto its own line under
      // the image, where a caption belongs.
      container.style.flexWrap = 'wrap';
      container.appendChild(caption);
      syncCaption(node.attrs.caption as string | null);

      // Hide until decoded so a half-loaded image doesn't flash at the wrong size.
      container.style.visibility = 'hidden';
      container.style.pointerEvents = 'none';
      const reveal = () => {
        container.style.visibility = '';
        container.style.pointerEvents = '';
      };
      el.onload = reveal;
      el.onerror = reveal;
      if (el.complete) reveal();

      return nodeView;
    };
  }
});

/** Default resize configuration — all eight anchors, aspect ratio locked. */
export const DEFAULT_IMAGE_RESIZE: ImageResizeConfig = {
  enabled: true,
  directions: [
    'left',
    'right',
    'top',
    'bottom',
    'top-left',
    'top-right',
    'bottom-left',
    'bottom-right'
  ],
  minWidth: 60,
  alwaysPreserveAspectRatio: true
};
