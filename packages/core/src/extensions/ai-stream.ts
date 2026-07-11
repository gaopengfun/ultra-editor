import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface AIStreamRange {
  from: number;
  to: number;
  /**
   * The region swallowed an empty block to start (the `/write` case). Accept has
   * to put that block back before replaying the text, or undo lands the author in
   * a document that has quietly lost the paragraph they were standing in.
   */
  consumedEmptyBlock?: boolean;
}

interface StreamMeta {
  set?: AIStreamRange;
  clear?: true;
}

const aiStreamKey = new PluginKey<AIStreamRange | null>('ueAiStream');

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiStream: {
      /** Open a streaming region at the cursor (or replacing the selection). */
      aiStreamStart: () => ReturnType;
      /** Render the accumulated text into the streaming region. Idempotent. */
      aiStreamSet: (text: string) => ReturnType;
      /** Keep the generated text, as a single undoable step. */
      aiStreamAccept: () => ReturnType;
      /** Remove the generated text and leave the document as it was. */
      aiStreamDiscard: () => ReturnType;
    };
  }
}

/** Where the AI is currently writing, or null when it isn't. */
export function aiStreamRange(state: EditorState): AIStreamRange | null {
  return aiStreamKey.getState(state) ?? null;
}

export function isAIStreaming(state: EditorState): boolean {
  return aiStreamRange(state) !== null;
}

/**
 * Turn plain model output into block nodes. Models emit prose with blank lines
 * between paragraphs and single newlines inside them, so that's what we honour —
 * a single `insertText` would bake the newlines in as literal characters.
 */
function textToNodes(text: string, schema: EditorState['schema']): ProseMirrorNode[] {
  const paragraph = schema.nodes.paragraph;
  const hardBreak = schema.nodes.hardBreak;

  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    const content: ProseMirrorNode[] = [];
    lines.forEach((line, index) => {
      if (index > 0 && hardBreak) content.push(hardBreak.create());
      if (line) content.push(schema.text(line));
    });
    return paragraph.create(null, content);
  });
}

/** Writes bypass history: the whole generation lands as one step on accept. */
const silent = (tr: Transaction) => tr.setMeta('addToHistory', false);

/**
 * What the streaming region should contain to be back where it started: nothing,
 * or the empty block the region swallowed on the way in.
 */
function undoTarget(state: EditorState, range: AIStreamRange): ProseMirrorNode[] {
  return range.consumedEmptyBlock ? [state.schema.nodes.paragraph.create()] : [];
}

/**
 * Where a generation should be written, expressed at block granularity.
 *
 * This matters more than it looks. Writing paragraphs at an *inline* cursor makes
 * ProseMirror split the host block to fit them, which (a) leaves an orphaned
 * fragment outside the range we're tracking and (b) makes the range's end
 * unpredictable, so discarding no longer removes exactly what was added. Anchored
 * to a block edge, the nodes go in verbatim and the range arithmetic is exact.
 *
 * An empty block (the `/write` case — the slash text was just deleted) is
 * replaced outright; a block with content is appended after, so a continuation
 * never lands in the middle of the author's sentence.
 */
function blockTarget(state: EditorState): AIStreamRange {
  const $pos = state.doc.resolve(state.selection.to);

  let depth = $pos.depth;
  while (depth > 0 && !$pos.node(depth).isTextblock) depth--;

  if (depth === 0) {
    const pos = state.selection.to;
    return { from: pos, to: pos };
  }

  const block = $pos.node(depth);
  const start = $pos.before(depth);
  const end = $pos.after(depth);

  return block.content.size === 0
    ? { from: start, to: end, consumedEmptyBlock: true }
    : { from: end, to: end };
}

/**
 * The document side of AI generation: a region that the model streams into,
 * visibly marked, which the user can then keep or throw away.
 *
 * The generated text is written with history disabled and only replayed as a
 * real edit when accepted, so a rejected generation leaves no trace and an
 * accepted one is a single Ctrl-Z away — rather than a hundred of them, one per
 * streamed chunk.
 */
export const AIStream = Extension.create({
  name: 'aiStream',

  addCommands() {
    return {
      // Tiptap hands each command the transaction it is going to dispatch; `dispatch`
      // itself is only a marker (it is undefined during `can()` probes). Commands
      // therefore mutate `tr` — building a fresh `state.tr` and dispatching that
      // silently does nothing.
      aiStreamStart:
        () =>
        ({ state, tr, dispatch }) => {
          if (aiStreamRange(state)) return false;
          if (dispatch) {
            silent(tr).setMeta(aiStreamKey, { set: blockTarget(state) } satisfies StreamMeta);
          }
          return true;
        },

      aiStreamSet:
        (text) =>
        ({ state, tr, dispatch }) => {
          const range = aiStreamRange(state);
          if (!range) return false;
          if (dispatch) {
            const nodes = text ? textToNodes(text, state.schema) : [];
            silent(tr).replaceWith(range.from, range.to, nodes);
            // Take the end from the transaction's own mapping rather than summing
            // node sizes: if ProseMirror adjusts the slice to fit, the mapping is
            // right and the arithmetic is not.
            const to = tr.mapping.map(range.to, 1);
            tr.setMeta(aiStreamKey, {
              set: { from: range.from, to, consumedEmptyBlock: range.consumedEmptyBlock }
            } satisfies StreamMeta);
          }
          return true;
        },

      aiStreamAccept:
        () =>
        ({ state, tr, dispatch, view }) => {
          const range = aiStreamRange(state);
          if (!range) return false;
          if (!dispatch || !view) return true;

          // Accept needs two transactions — a history-less rollback and a real
          // edit — so it drives the view itself and tells Tiptap not to dispatch
          // the (now stale) transaction it prepared.
          tr.setMeta('preventDispatch', true);

          // Lift the generated nodes straight out of the document: no second copy
          // of the text to keep in sync, and marks and structure survive exactly.
          const generated = view.state.doc.slice(range.from, range.to).content;

          const restored = undoTarget(view.state, range);
          const restoredSize = restored.reduce((size, node) => size + node.nodeSize, 0);

          const rollback = silent(view.state.tr.replaceWith(range.from, range.to, restored));
          rollback.setMeta(aiStreamKey, { clear: true } satisfies StreamMeta);
          view.dispatch(rollback);

          if (generated.size === 0) return true;

          // Re-applied as one ordinary edit, so undo removes the whole passage at
          // once instead of unwinding it one streamed chunk at a time — and lands
          // back on the pre-generation document, empty paragraph included.
          view.dispatch(
            view.state.tr.replaceWith(range.from, range.from + restoredSize, generated)
          );
          return true;
        },

      aiStreamDiscard:
        () =>
        ({ state, tr, dispatch }) => {
          const range = aiStreamRange(state);
          if (!range) return false;
          if (dispatch) {
            silent(tr)
              .replaceWith(range.from, range.to, undoTarget(state, range))
              .setMeta(aiStreamKey, { clear: true } satisfies StreamMeta);
          }
          return true;
        }
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<AIStreamRange | null>({
        key: aiStreamKey,
        state: {
          init: () => null,
          apply(tr, current) {
            const meta = tr.getMeta(aiStreamKey) as StreamMeta | undefined;
            if (meta?.clear) return null;
            if (meta?.set) return meta.set;
            if (!current) return null;
            return {
              from: tr.mapping.map(current.from, -1),
              to: tr.mapping.map(current.to, 1)
            };
          }
        },
        props: {
          decorations(state) {
            const range = aiStreamKey.getState(state);
            if (!range || range.from === range.to) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'ue-ai-streamed' })
            ]);
          }
        }
      })
    ];
  }
});
