import { reactive, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
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
 * Generation into the document is done through the AIStream extension so that a
 * discarded result leaves nothing behind and an accepted one is a single undo
 * step. Selection transforms stream into the panel instead, so the author can
 * compare the suggestion against the original before committing to it.
 */
export function useAi(
  editor: Ref<Editor | undefined>,
  provider: Ref<AIProvider | null | undefined>,
  t: Translator,
  locale: Ref<LocaleName>
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
  let selection: {
    from: number;
    to: number;
    text: string;
    /** True when the selection sits inside a single text block without filling it. */
    inline: boolean;
    /** Position just after the block that holds the selection — where "insert below" goes. */
    blockAfter: number;
  } | null = null;
  let context = '';
  let wasEditable = true;

  // Matches the panel's max width / typical height in the stylesheet. Clamping to
  // anything smaller lets the panel hang off the right edge of the viewport.
  const PANEL_WIDTH = 560;
  const PANEL_HEIGHT = 240;
  const MARGIN = 16;

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

    selection = {
      from,
      to,
      text: instance.state.doc.textBetween(from, to, '\n\n', ' '),
      inline: sameBlock && $from.parent.isTextblock && !fillsBlock,
      blockAfter: $to.depth > 0 ? $to.after($to.depth) : to
    };

    context = instance.state.doc.textBetween(
      Math.max(0, from - CONTEXT_LENGTH),
      from,
      '\n\n',
      ' '
    );
  }

  function lockEditor(locked: boolean) {
    const instance = editor.value;
    if (!instance) return;
    if (locked) {
      wasEditable = instance.isEditable;
      instance.setEditable(false);
    } else {
      instance.setEditable(wasEditable);
    }
  }

  function execute() {
    const instance = editor.value;
    const ai = provider.value;
    if (!instance || !ai) {
      state.phase = 'error';
      state.error = t('ai.noProvider');
      return;
    }

    state.phase = 'running';
    state.text = '';
    state.error = '';

    const insert = state.mode === 'insert';
    if (insert) {
      instance.commands.aiStreamStart();
      lockEditor(true);
    }

    run = runAITask(
      ai,
      {
        task: state.task,
        text: selection?.text ?? '',
        context,
        instruction: state.instruction || undefined,
        locale: locale.value
      },
      {
        onChunk: (_chunk, accumulated) => {
          state.text = accumulated;
          if (insert) instance.commands.aiStreamSet(accumulated);
        },
        onDone: () => {
          state.phase = 'done';
        },
        onAbort: () => {
          state.phase = 'done';
        },
        onError: (error) => {
          state.phase = 'error';
          state.error = error.message || t('ai.failed');
          if (insert) {
            instance.commands.aiStreamDiscard();
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
    const instance = editor.value;
    if (!instance) return;

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
    run = null;
  }

  function cleanup() {
    run = null;
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
    if (!text || !selection) {
      cleanup();
      return;
    }

    if (placement === 'replace') {
      const content = selection.inline ? inlineContent(text) : blockContent(text);
      instance
        .chain()
        .focus()
        .insertContentAt({ from: selection.from, to: selection.to }, content)
        .run();
    } else {
      // "Below" always means a new block after the one being worked on — never
      // spliced into the middle of the host paragraph.
      instance.chain().focus().insertContentAt(selection.blockAfter, blockContent(text)).run();
    }
    cleanup();
  }

  function discard() {
    stop();
    const instance = editor.value;
    if (instance && state.mode === 'insert') {
      instance.commands.aiStreamDiscard();
      lockEditor(false);
    }
    cleanup();
  }

  function retry() {
    if (state.mode === 'insert') {
      editor.value?.commands.aiStreamDiscard();
      lockEditor(false);
    }
    execute();
  }

  return { state, start, submit, stop, retry, accept, discard };
}
