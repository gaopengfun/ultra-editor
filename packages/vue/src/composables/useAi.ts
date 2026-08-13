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
} from '@ultra-editor/core/lean';

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
    // Every caller trims first, so `split` cannot hand back an empty block here.
    // Kept because an empty text node is invalid in ProseMirror and throws.
    /* v8 ignore next */
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
  valid: boolean;
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
  let lockedEditor: Editor | null = null;
  let watchedEditor: Editor | null = null;
  let renderFrame: number | null = null;
  let pendingInsertText: string | null = null;
  /**
   * Bumped whenever a run is abandoned. `abort()` only resolves on a later
   * microtask, so a replaced run still gets its `onAbort`/`onChunk` after its
   * successor has already set `phase` to running — without a token to check, the
   * dead run stomps the live one's state back to `done`.
   */
  let generation = 0;

  function cancelPendingRender() {
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = null;
    pendingInsertText = null;
  }

  function flushPendingRender(mine: number) {
    if (renderFrame !== null) cancelAnimationFrame(renderFrame);
    renderFrame = null;
    if (mine !== generation || pendingInsertText === null) return;
    const text = pendingInsertText;
    pendingInsertText = null;
    state.text = text;
    editor.value?.commands.aiStreamSet(text);
  }

  function scheduleInsertRender(text: string, mine: number) {
    pendingInsertText = text;
    if (renderFrame !== null) return;
    renderFrame = requestAnimationFrame(() => flushPendingRender(mine));
  }

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
    let from = target.from;
    let to = target.to;
    let blockAfter = target.blockAfter;
    let valid = target.valid;

    for (const map of transaction.mapping.maps) {
      if (from < to) {
        map.forEach((oldStart, oldEnd) => {
          if (oldEnd > oldStart && oldStart <= from && oldEnd >= to) valid = false;
        });
      }
      const nextFrom = map.map(from, -1);
      const nextTo = map.map(to, 1);
      from = Math.min(nextFrom, nextTo);
      to = Math.max(nextFrom, nextTo);
      blockAfter = map.map(blockAfter, 1);
    }

    if (target.from < target.to && from === to) valid = false;
    target = {
      ...target,
      valid,
      from: Math.min(from, size),
      to: Math.min(to, size),
      blockAfter: Math.min(blockAfter, size)
    };
  };

  function watchEdits(on: boolean) {
    const instance = editor.value;
    if (!on) {
      watchedEditor?.off('transaction', followEdits);
      watchedEditor = null;
      return;
    }
    if (!instance || watchedEditor === instance) return;
    watchedEditor?.off('transaction', followEdits);
    instance.on('transaction', followEdits);
    watchedEditor = instance;
  }

  function anchorToCursor(instance: Editor) {
    const coords = instance.view.coordsAtPos(instance.state.selection.to);
    state.anchor = {
      x: Math.max(MARGIN, Math.min(coords.left, window.innerWidth - PANEL_WIDTH - MARGIN)),
      y: Math.max(MARGIN, Math.min(coords.bottom + 8, window.innerHeight - PANEL_HEIGHT - MARGIN))
    };
  }

  function capture(instance: Editor) {
    const { from, to, $from, $to } = instance.state.selection;

    const sameBlock = $from.sameParent($to);
    const fillsBlock =
      sameBlock && $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;

    target = {
      from,
      to,
      valid: true,
      inline: sameBlock && $from.parent.isTextblock && !fillsBlock,
      blockAfter: $to.depth > 0 ? $to.after($to.depth) : to
    };

    context = instance.state.doc.textBetween(Math.max(0, from - CONTEXT_LENGTH), from, '\n\n', ' ');
  }

  /** Locking is only for insert mode, where the model writes into the live document. */
  function lockEditor(on: boolean) {
    const instance = editor.value;
    if (on) {
      locked = true;
      lockedEditor = instance!;
      instance!.setEditable(false);
      return;
    }
    if (!locked) return;
    locked = false;
    // Restore what the host currently wants, not what was true when we locked —
    // `editable` may have been switched to false while the model was writing.
    const targetEditor = lockedEditor!;
    if (!targetEditor.isDestroyed) targetEditor.setEditable(isEditable());
    lockedEditor = null;
  }

  /**
   * Let go of the running generation: stop the stream and disown its callbacks.
   * Always abort — an orphaned stream keeps costing money after nobody is watching.
   */
  function abandon() {
    run?.abort();
    run = null;
    cancelPendingRender();
    generation += 1;
  }

  function execute() {
    const instance = editor.value;
    const ai = provider.value;
    if (!instance || !ai) {
      state.phase = 'error';
      state.error = t.value('ai.noProvider');
      return;
    }

    if (state.mode === 'transform' && (!target || !target.valid)) {
      watchEdits(false);
      state.phase = 'error';
      state.error = t.value('ai.selectionChanged');
      return;
    }

    // Starting again while one is in flight replaces it; the old one must not be
    // left streaming into the state this run now owns.
    abandon();
    const mine = generation;

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
          /* v8 ignore next -- an abandoned run is routed to onAbort by runAITask */
          if (mine !== generation) return;
          if (insert) scheduleInsertRender(accumulated, mine);
          else state.text = accumulated;
        },
        onDone: () => {
          /* v8 ignore next -- an abandoned run is routed to onAbort by runAITask */
          if (mine !== generation) return;
          if (insert) flushPendingRender(mine);
          state.phase = 'done';
        },
        // The only handler an abandoned run can still reach: `abort()` settles on a
        // later microtask, by which point its replacement has already set `running`.
        // The other three are unreachable once aborted — runAITask stops pulling
        // chunks and routes the outcome here rather than to done/error.
        onAbort: () => {
          if (mine === generation) {
            if (insert) flushPendingRender(mine);
            state.phase = 'done';
          }
        },
        onError: (error) => {
          /* v8 ignore next -- an abandoned run is routed to onAbort by runAITask */
          if (mine !== generation) return;
          cancelPendingRender();
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
    const instance = editor.value;
    if (!instance) return;

    const nextMode = SELECTION_TASKS.includes(task) ? 'transform' : 'insert';
    if (state.open) {
      abandon();
      watchEdits(false);
      if (state.mode === 'insert' && nextMode !== 'insert') {
        instance.commands.aiStreamDiscard();
        lockEditor(false);
      }
    }

    capture(instance);
    anchorToCursor(instance);

    state.task = task;
    state.mode = nextMode;
    state.instruction = '';
    state.text = '';
    state.error = '';
    state.open = true;

    if (NEEDS_INSTRUCTION.includes(task)) {
      state.phase = 'prompt';
      if (nextMode === 'transform') watchEdits(true);
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

  function cleanup() {
    abandon();
    watchEdits(false);
    lockEditor(false);
    target = null;
    state.open = false;
    state.text = '';
    state.instruction = '';
  }

  function accept(placement: 'replace' | 'below' = 'replace') {
    const instance = editor.value;
    if (!instance) return;

    if (state.mode === 'insert') {
      flushPendingRender(generation);
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
    if (!target.valid) {
      watchEdits(false);
      state.phase = 'error';
      state.error = t.value('ai.selectionChanged');
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
    const instance = editor.value ?? lockedEditor;
    run?.abort();
    if (instance && !instance.isDestroyed) instance.commands.aiStreamDiscard();
    lockEditor(false);
    cleanup();
  }

  /** Throw away the previous attempt — including whatever it wrote — and run again. */
  function retry() {
    abandon();
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
    abandon();
    watchEdits(false);
    const instance = editor.value ?? lockedEditor;
    if (instance && !instance.isDestroyed) instance.commands.aiStreamDiscard();
    lockEditor(false);
  });

  return { state, start, submit, stop, retry, accept, discard };
}
