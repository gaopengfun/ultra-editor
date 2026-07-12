import { TableRow } from '@tiptap/extension-table';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const MIN_ROW_HEIGHT = 24;
const GRAB_ZONE = 5;

const rowResizeKey = new PluginKey<{ activeRow: number | null }>('ueTableRowResizing');

type Drag = {
  row: HTMLTableRowElement;
  rowPos: number;
  startY: number;
  startHeight: number;
} | null;

/** Is the pointer within grabbing distance of a row's bottom edge? */
function rowBorderAt(view: EditorView, event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const row = target?.closest?.('tr') as HTMLTableRowElement | null;
  if (!row || !view.dom.contains(row)) return null;

  const rect = row.getBoundingClientRect();
  if (Math.abs(event.clientY - rect.bottom) > GRAB_ZONE) return null;

  let rowPos: number | null = null;
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(row, 0));
    for (let depth = $pos.depth; depth > 0; depth--) {
      if ($pos.node(depth).type.name === 'tableRow') {
        rowPos = $pos.before(depth);
        break;
      }
    }
    // `posAtDOM` only throws for DOM outside the editor, which the `view.dom.contains`
    // check above has already ruled out. Kept because it is the documented failure
    // mode, and a stray row is exactly what this function exists to survive.
  } catch {
    /* v8 ignore next */
    return null;
  }
  if (rowPos == null) return null;
  return { row, rowPos };
}

/**
 * Mark every cell of the active row so CSS can draw the indicator bar on the
 * cell's bottom edge. Anchoring to cells (not the row) means the bar tracks the
 * row height live during the drag — same trick ProseMirror's column handle uses.
 */
function rowDecorations(doc: ProseMirrorNode, activeRow: number | null): DecorationSet {
  if (activeRow == null) return DecorationSet.empty;
  const rowNode = doc.nodeAt(activeRow);
  if (!rowNode || rowNode.type.name !== 'tableRow') return DecorationSet.empty;

  const decorations: Decoration[] = [];
  let offset = activeRow + 1;
  rowNode.forEach((cell) => {
    decorations.push(
      Decoration.node(offset, offset + cell.nodeSize, { class: 'ue-row-resize-target' })
    );
    offset += cell.nodeSize;
  });
  return DecorationSet.create(doc, decorations);
}

function rowResizingPlugin() {
  let dragging: Drag = null;
  // Tracked so an editor destroyed mid-drag can take its document listeners with
  // it — otherwise they outlive the view and fire against a dead one.
  let endDrag: (() => void) | null = null;

  return new Plugin<{ activeRow: number | null }>({
    key: rowResizeKey,

    view() {
      return {
        destroy() {
          endDrag?.();
        }
      };
    },
    state: {
      init: () => ({ activeRow: null }),
      apply(tr, current) {
        const meta = tr.getMeta(rowResizeKey) as number | null | undefined;
        if (meta !== undefined) return { activeRow: meta };
        if (current.activeRow != null && tr.docChanged) {
          return { activeRow: tr.mapping.map(current.activeRow) };
        }
        return current;
      }
    },
    props: {
      decorations(state) {
        return rowDecorations(state.doc, rowResizeKey.getState(state)?.activeRow ?? null);
      },
      handleDOMEvents: {
        mousemove(view, event) {
          if (dragging) return false;
          const info = rowBorderAt(view, event);
          view.dom.style.cursor = info ? 'row-resize' : '';
          const current = rowResizeKey.getState(view.state)?.activeRow ?? null;
          const next = info ? info.rowPos : null;
          if (next !== current) view.dispatch(view.state.tr.setMeta(rowResizeKey, next));
          return false;
        },

        mouseleave(view) {
          if (dragging) return false;
          if ((rowResizeKey.getState(view.state)?.activeRow ?? null) != null) {
            view.dispatch(view.state.tr.setMeta(rowResizeKey, null));
          }
          return false;
        },

        mousedown(view, event) {
          const info = rowBorderAt(view, event);
          if (!info) return false;
          event.preventDefault();

          const drag: NonNullable<Drag> = {
            row: info.row,
            rowPos: info.rowPos,
            startY: event.clientY,
            startHeight: info.row.getBoundingClientRect().height
          };
          dragging = drag;

          view.dom.classList.add('ue-row-resizing');
          if ((rowResizeKey.getState(view.state)?.activeRow ?? null) !== info.rowPos) {
            view.dispatch(view.state.tr.setMeta(rowResizeKey, info.rowPos));
          }

          const heightAt = (e: MouseEvent) =>
            Math.max(MIN_ROW_HEIGHT, Math.round(drag.startHeight + (e.clientY - drag.startY)));

          const onMove = (e: MouseEvent) => {
            drag.row.style.height = `${heightAt(e)}px`;
          };

          const detach = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            dragging = null;
            endDrag = null;
          };

          const onUp = (e: MouseEvent) => {
            detach();

            const height = heightAt(e);
            view.dom.style.cursor = '';
            view.dom.classList.remove('ue-row-resizing');

            // Prefer the plugin's mapped position — the doc may have changed under
            // us mid-drag, which would leave the captured position pointing at the
            // wrong row (or at nothing).
            const rowPos = rowResizeKey.getState(view.state)?.activeRow ?? drag.rowPos;
            let tr = view.state.tr.setMeta(rowResizeKey, null);
            const node = view.state.doc.nodeAt(rowPos);
            if (node && node.type.name === 'tableRow') {
              tr = tr.setNodeMarkup(rowPos, undefined, { ...node.attrs, height });
            }
            view.dispatch(tr);
          };

          endDrag = detach;
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
          return true;
        }
      }
    }
  });
}

/** Table rows with a draggable bottom edge; the height persists as an inline style. */
export const ResizableTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      height: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const height = parseInt(el.style.height || '', 10);
          return Number.isFinite(height) ? height : null;
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const height = attributes.height as number | null;
          return height ? { style: `height: ${height}px` } : {};
        }
      }
    };
  },

  addProseMirrorPlugins() {
    return [rowResizingPlugin()];
  }
});
