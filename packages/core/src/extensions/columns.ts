import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { isBrowser } from '../utils/env';
import { createTranslator, type LocaleName, type Messages, type Translator } from '../i18n';
import { ULTRA_EDITOR_OPTIONS_META } from './runtime-options';

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 5;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columnBlock: {
      /** Insert a 1–5 column card row at the cursor. Refuses when already inside one. */
      insertColumns: (count?: number) => ReturnType;
    };
  }
}

export interface ColumnBlockOptions {
  locale: LocaleName;
  messages: Partial<Messages>;
  translator?: () => Translator;
}

/** A single card. Not in the `block` group, so it can only exist inside a columnBlock. */
export const Column = TiptapNode.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div.ue-column' }, { tag: 'div.tiptap-column' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'ue-column' }), 0];
  }
});

const ICON = {
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  sub: '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  del: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
};

/**
 * The column row. Renders as a flex container; in the editor it grows a hover
 * toolbar for add / remove / delete, drawn by the node view so it never leaks
 * into the serialised HTML.
 */
export const ColumnBlock = TiptapNode.create<ColumnBlockOptions>({
  name: 'columnBlock',
  group: 'block',
  content: `column{${MIN_COLUMNS},${MAX_COLUMNS}}`,
  isolating: true,
  defining: true,

  addOptions() {
    return {
      locale: 'zh-CN',
      messages: {},
      translator: undefined
    };
  },

  parseHTML() {
    return [{ tag: 'div.ue-columns' }, { tag: 'div.tiptap-columns' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'ue-columns',
        'data-cols': String(node.childCount)
      }),
      0
    ];
  },

  addCommands() {
    return {
      insertColumns:
        (count = 2) =>
        ({ state, commands }) => {
          const { $from } = state.selection;
          for (let depth = $from.depth; depth > 0; depth--) {
            const name = $from.node(depth).type.name;
            if (name === 'column' || name === 'columnBlock') return false;
          }
          const total = Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(count)));
          const columnType = state.schema.nodes.column;
          const columns = [];
          for (let i = 0; i < total; i++) {
            const filled = columnType.createAndFill();
            /* v8 ignore next */
            if (filled) columns.push(filled);
          }
          // `column` holds `block+`, which `createAndFill` always satisfies with an
          // empty paragraph — so neither guard above can fire. Both are here to keep
          // a schema change from silently inserting a malformed block.
          /* v8 ignore next */
          if (!columns.length) return false;
          return commands.insertContent(this.type.create(null, columns).toJSON());
        }
    };
  },

  addNodeView() {
    if (!isBrowser()) return null;
    const fallback: Translator = createTranslator(this.options.locale, this.options.messages);
    const t = () => this.options.translator?.() ?? fallback;

    return ({ editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'ue-columns-wrapper';

      const toolbar = document.createElement('div');
      toolbar.className = 'ue-columns__toolbar';
      toolbar.setAttribute('contenteditable', 'false');

      const contentDOM = document.createElement('div');
      contentDOM.className = 'ue-columns';

      // Re-resolve on every action: the closed-over node/pos go stale the moment
      // anything above this block changes.
      // Tiptap always hands a node view a `getPos` function, and a live position
      // always resolves back to this node — the two fallbacks below only cover a
      // torn-down view, which already leaves through the `pos == null` arm.
      const current = () => {
        /* v8 ignore next */
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return null;
        const node = editor.state.doc.nodeAt(pos);
        /* v8 ignore next */
        return node && node.type.name === 'columnBlock' ? { pos, node } : null;
      };

      const makeButton = (title: string, svg: string, danger: boolean, onClick: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.title = title;
        button.className = 'ue-columns__btn' + (danger ? ' ue-columns__btn--danger' : '');
        button.innerHTML = svg;
        // Without this the editor blurs on mousedown and the selection jumps away
        // before the click handler ever runs.
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', (event) => {
          event.preventDefault();
          onClick();
        });
        return button;
      };

      const addButton = makeButton(t()('columns.add'), ICON.add, false, () => {
        if (!editor.isEditable) return;
        const cur = current();
        if (!cur || cur.node.childCount >= MAX_COLUMNS) return;
        const column = editor.schema.nodes.column.createAndFill();
        /* v8 ignore next */
        if (!column) return;
        editor.view.dispatch(editor.state.tr.insert(cur.pos + cur.node.nodeSize - 1, column));
        editor.view.focus();
      });

      const removeButton = makeButton(t()('columns.remove'), ICON.sub, false, () => {
        if (!editor.isEditable) return;
        const cur = current();
        if (!cur || cur.node.childCount <= MIN_COLUMNS) return;
        const last = cur.node.child(cur.node.childCount - 1);
        const to = cur.pos + cur.node.nodeSize - 1;
        editor.view.dispatch(editor.state.tr.delete(to - last.nodeSize, to));
        editor.view.focus();
      });

      const deleteButton = makeButton(t()('columns.delete'), ICON.del, true, () => {
        if (!editor.isEditable) return;
        const cur = current();
        if (!cur) return;
        editor
          .chain()
          .focus()
          .deleteRange({ from: cur.pos, to: cur.pos + cur.node.nodeSize })
          .run();
      });

      let currentCount = MIN_COLUMNS;
      const syncDisabled = (count = currentCount) => {
        currentCount = count;
        addButton.disabled = !editor.isEditable || count >= MAX_COLUMNS;
        removeButton.disabled = !editor.isEditable || count <= MIN_COLUMNS;
        deleteButton.disabled = !editor.isEditable;
      };

      toolbar.append(addButton, removeButton, deleteButton);
      dom.append(toolbar, contentDOM);

      // The node is provably in the document while its own view is being built, so
      // the `??` fallbacks are for the type, not for a case that can happen.
      const initial = current();
      /* v8 ignore next */
      contentDOM.setAttribute('data-cols', String(initial?.node.childCount ?? MIN_COLUMNS));
      /* v8 ignore next */
      syncDisabled(initial?.node.childCount ?? MIN_COLUMNS);

      const syncRuntimeOptions = ({
        transaction
      }: {
        transaction: import('@tiptap/pm/state').Transaction;
      }) => {
        if (!transaction.getMeta(ULTRA_EDITOR_OPTIONS_META)) return;
        addButton.title = t()('columns.add');
        removeButton.title = t()('columns.remove');
        deleteButton.title = t()('columns.delete');
      };
      editor.on('transaction', syncRuntimeOptions);
      const syncEditable = () => syncDisabled();
      editor.on('update', syncEditable);

      return {
        dom,
        contentDOM,
        update: (updatedNode) => {
          // ProseMirror only calls a node view's `update` when the incoming node has
          // the same type (CustomNodeViewDesc gates on `this.node.type == node.type`
          // unless the spec opts into `multiType`, which this one does not).
          /* v8 ignore next */
          if (updatedNode.type.name !== 'columnBlock') return false;
          contentDOM.setAttribute('data-cols', String(updatedNode.childCount));
          syncDisabled(updatedNode.childCount);
          return true;
        },
        stopEvent: (event) => toolbar.contains(event.target as Node),
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          return !contentDOM.contains(mutation.target as Node);
        },
        destroy: () => {
          editor.off('transaction', syncRuntimeOptions);
          editor.off('update', syncEditable);
        }
      };
    };
  }
});
