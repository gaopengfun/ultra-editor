import { TableCell, TableHeader } from '@tiptap/extension-table';
import { contrastText } from '../utils/color';

/**
 * Background colour on cells, serialised as inline style so it survives into
 * plain HTML. The text colour is derived, not stored — a user who picks a dark
 * fill should not also have to pick white text.
 */
function backgroundAttribute() {
  return {
    backgroundColor: {
      default: null as string | null,
      parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
      renderHTML: (attributes: Record<string, unknown>) => {
        const background = attributes.backgroundColor as string | null;
        if (!background) return {};
        return { style: `background-color: ${background}; color: ${contrastText(background)}` };
      }
    }
  };
}

export const ColorTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundAttribute() };
  }
});

export const ColorTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...backgroundAttribute() };
  }
});
