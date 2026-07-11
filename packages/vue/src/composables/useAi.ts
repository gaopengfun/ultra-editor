import { onScopeDispose, reactive, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { Transaction } from '@tiptap/pm/state';
import {
  runAITask,
  SELECTION_TASKS,
  type AIProvider,
  type AIRun,
  type AITask,
  type LocaleName,
  type Translator
} from '@ultra-editor/core';

export type AIPhase = 'prompt' | 'running' | 'done' | 'error';
/** `insert` streams into the document; `transform` streams into a preview panel. */
export type AIMode = 'insert' | 'transform';

export interface AIPanelState {
  open: boolean;
  phase: AIPhase;
  mode: AIMode;
  task: AITask;
  instruction: string;
  text: string;
  error: string;
  anchor: { x: number; y: number };
}

/** Tasks that can't run until the user says *what* — a language, a tone, a brief. */
const NEEDS_INSTRUCTION: AITask[] = ['write', 'custom', 'translate', 'changeTone'];

const CONTEXT_LENGTH = 2000;

/** Matches the panel's max width / typical height in the stylesheet. */
const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 240;
const MARGIN = 16;

/** Model output as block content: one paragraph per blank-line-separated block. */
function blockContent(text: string) {
  return text.split(/\n{2,}/).map((block) => ({
    type: 'paragraph',
    content: block ? [{ type: 'text', text: block.replace(/\n/g, ' ') }] : []
  }));
}

/**
 * Model output as inline content.
 *
 * Replacing a few selected words with a *paragraph* would tear the surrounding
 * paragraph into three, so a selection that lives inside one text block gets
 * inline content back — line breaks become hard breaks, not new blocks.
 */
function inlineContent(text: string) {
  const lines = text.split(/\n+/).filter(Boolean);
  return lines.flatMap((line, index) =>
    index === 0
      ? [{ type: 'text', text: line }]
      : [{ type: 'hardBreak' }, { type: 'text', text: line }]
  );
}

interface Target {
  from: number;
  to: number;
  /** True when the selection sits inside a single text block without filling it. */
  inline: boolean;
  /** Position just after the block holding the selection — where "insert below" goes. */
  blockAfter: number;
}

export interface AIController {
  state: AIPanelState;
  start: (task: AITask) => void;
  submit: () => void;
  stop: () => void;
  retry: () => void;
  accept: (placement?: 'replace' | 'below') => void;
  discard: () => void;
}

/**
 * Orchestrates one AI generation at a time.
 *
 * Generation into the document goes through the AIStream extension, so a discarded
 * result leaves nothing behind and an accepted one is a single undo step. Selection
 * transforms stream into the panel instead, letting the author compare the
 * suggestion against the original before committing to it.
 */
export function useAi(
  editor: Ref<Editor | undefined>,
  provider: Ref<AIProvider | null | undefined>,
  t: Ref<Translator>,
  locale: Ref<LocaleName>,
  isEditable: () => boolean
): AIController {
  const state = reactive<AIPanelState>({
    open: false,
    phase: 'done',
    mode: 'insert',
    task: 'continue',
    instruction: '',
    text: '',
    error: '',
    anchor: { x: 0, y: 0 }
  });

  let run: AIRun | null = null;
  let target: Target | null = null;
  let context = '';
  let locked = false;

  /**
   * The document stays editable while a transform streams into the panel, so the
   * positions captured at start can be anywhere by the time the user accepts.
   * Ride every transaction's mapping to keep them pointing at the same text —
   * otherwise "replace" overwrites an unrelated span, or throws when the captured
   * range now falls outside the document.
   */
  const followEdits = ({ transaction }: { transaction: Transaction }) => {
    if (!target || !transaction.docChanged) return;
    const size = transaction.doc.content.size;
    const from = Math.min(transaction.mapping.map(target.from, -1), size);
    const to = Math.min(transaction.mapping.map(target.to, 1), size);
    target = {
      ...target,
      from: Math.min(from, to),
      to: Math.max(from, to),
      blockAfter: Math.min(transaction.mapping.map(target.blockAfter, 1), size)
    };
  };

  function watchEdits(on: boolean) {
    const instance = editor.value;
    if (!instance) return;
    if (on) instance.on('transaction', followEdits);
    else instance.off('transaction', followEdits);
  }

  function anchorToCursor() {
    const instance = editor.value;
    if (!instance) return;

    const coords = instance.view.coordsAtPos(instance.state.selection.to);
    state.anchor = {
      x: Math.max(MARGIN, Math.min(coords.left, window.innerWidth - PANEL_WIDTH - MARGIN)),
      y: Math.max(MARGIN, Math.min(coords.bottom + 8, window.innerHeight - PANEL_HEIGHT - MARGIN))
    };
  }

  function capture() {
    const instance = editor.value;
    if (!instance) return;

    const { from, to, $from, $to } = instance.state.selection;

    const sameBlock = $from.sameParent($to);
    const fillsBlock =
      sameBlock && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;

    target = {
      from,
      to,
      inline: sameBlock && $from.parent.isTextblock && !fillsBlock,
      blockAfter: $to.depth > 0 ? $to.after($to.depth) : to
    };

    context = instance.state.doc.textBetween(Math.max(0, from - CONTEXT_LENGTH), from, '\n\n', ' ');
  }

  /** Locking is only for insert mode, where the model writes into the live document. */
  function lockEditor(on: boolean) {
    const instance = editor.value;
    if (!instance) return;
    if (on) {
      locked = true;
      instance.setEditable(false);
      return;
    }
    if (!locked) return;
    locked = false;
    // Restore what the host currently wants, not what was true when we locked —
    // `editable` may have been switched to false while the model was writing.
    instance.setEditable(isEditable());
  }

  function execute() {
    const instance = editor.value;
    const ai = provider.value;
    if (!instance || !ai) {
      state.phase = 'error';
      state.error = t.value('ai.noProvider');
      return;
    }

    const selectionText = target
      ? instance.state.doc.textBetween(target.from, target.to, '\n\n', ' ')
      : '';

    state.phase = 'running';
    state.text = '';
    state.error = '';

    const insert = state.mode === 'insert';
    if (insert) {
      instance.commands.aiStreamStart();
      lockEditor(true);
    } else {
      watchEdits(true);
    }

    run = runAITask(
      ai,
      {
        task: state.task,
        text: selectionText,
        context,
        instruction: state.instruction || undefined,
        locale: locale.value
      },
      {
        onChunk: (_chunk, accumulated) => {
          state.text = accumulated;
          if (insert) editor.value?.commands.aiStreamSet(accumulated);
        },
        onDone: () => {
          state.phase = 'done';
        },
        onAbort: () => {
          state.phase = 'done';
        },
        onError: (error) => {
          state.phase = 'error';
          state.error = error.message || t.value('ai.failed');
          if (insert) {
            editor.value?.commands.aiStreamDiscard();
            lockEditor(false);
          }
        }
      }
    );

    void run.done.catch(() => {
      // Already surfaced through onError; swallow so it isn't an unhandled rejection.
    });
  }

  function start(task: AITask) {
    if (!editor.value) return;

    capture();
    anchorToCursor();

    state.task = task;
    state.mode = SELECTION_TASKS.includes(task) ? 'transform' : 'insert';
    state.instruction = '';
    state.text = '';
    state.error = '';
    state.open = true;

    if (NEEDS_INSTRUCTION.includes(task)) {
      state.phase = 'prompt';
      return;
    }
    execute();
  }

  function submit() {
    if (!state.instruction.trim()) return;
    execute();
  }

  function stop() {
    run?.abort();
  }

  /** Always abort — an orphaned stream keeps costing money after nobody is watching. */
  function cleanup() {
    run?.abort();
    run = null;
    watchEdits(false);
    target = null;
    state.open = false;
    state.text = '';
    state.instruction = '';
  }

  function accept(placement: 'replace' | 'below' = 'replace') {
    const instance = editor.value;
    if (!instance) return;

    if (state.mode === 'insert') {
      instance.commands.aiStreamAccept();
      lockEditor(false);
      cleanup();
      return;
    }

    const text = state.text.trim();
    if (!text || !target) {
      cleanup();
      return;
    }

    // `target` has been ridden through every edit since capture, so these are the
    // live positions of the original selection.
    const { from, to, blockAfter, inline } = target;

    if (placement === 'replace') {
      const content = inline ? inlineContent(text) : blockContent(text);
      instance.chain().focus().insertContentAt({ from, to }, content).run();
    } else {
      // "Below" always means a new block after the one being worked on — never
      // spliced into the middle of the host paragraph.
      instance.chain().focus().insertContentAt(blockAfter, blockContent(text)).run();
    }
    cleanup();
  }

  function discard() {
    const instance = editor.value;
    if (instance && state.mode === 'insert') {
      run?.abort();
      instance.commands.aiStreamDiscard();
      lockEditor(false);
    }
    cleanup();
  }

  /** Throw away the previous attempt — including whatever it wrote — and run again. */
  function retry() {
    run?.abort();
    run = null;
    if (state.mode === 'insert') {
      editor.value?.commands.aiStreamDiscard();
      lockEditor(false);
    } else {
      watchEdits(false);
    }
    execute();
  }

  // A route change mid-generation must not leave the stream running.
  onScopeDispose(() => {
    run?.abort();
    run = null;
    watchEdits(false);
  });

  return { state, start, submit, stop, retry, accept, discard };
}
