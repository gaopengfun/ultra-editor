import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextSelection } from '@tiptap/pm/state';
import { createUltraKit } from '../kit';
import { AIAbortError } from '../ai/engine';
import type { AIProvider, AIProviderSource, AIRequest, Toggle } from '../ai/types';
import { GhostText, ghostSuggestion } from './ghost-text';

const CONTENT = '<p>正文内容</p>';
const DELAY = 10;
const GAP = 5;
const HINT = 'Tab 采纳';

interface GhostOptions {
  enabled?: Toggle;
  delay?: number | (() => number);
  minChars?: number;
  contextLength?: number;
  hint?: string;
}

function makeEditor(provider: AIProviderSource, ghost: GhostOptions = {}, content = CONTENT) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({
    element,
    content,
    extensions: createUltraKit({
      ai: {
        provider,
        ghostText: { enabled: true, delay: DELAY, minChars: 3, hint: HINT, ...ghost }
      }
    })
  });
}

/**
 * Yields its chunks a timer apart so a test can act mid-stream — and is
 * deliberately deaf to `signal`: it keeps producing after an abort, which is the
 * only way the extension's own abort handling becomes observable.
 */
function fake(chunks: string[], gap = GAP) {
  const seen: AIRequest[] = [];
  const stream = vi.fn(async function* (request: AIRequest): AsyncGenerator<string> {
    seen.push(request);
    for (const chunk of chunks) {
      await new Promise((resolve) => setTimeout(resolve, gap));
      yield chunk;
    }
  });
  return { provider: { stream } satisfies AIProvider, stream, seen };
}

function failing(error: unknown) {
  // eslint-disable-next-line require-yield
  const stream = vi.fn(async function* (): AsyncGenerator<string> {
    await Promise.resolve();
    throw error;
  });
  return { provider: { stream } satisfies AIProvider, stream };
}

/** The end of the only text block in a single-block fixture. */
const endOf = (target: Editor) => target.state.doc.content.size - 1;

const ghostEl = (target: Editor) => target.view.dom.querySelector('.ue-ghost');

/** Tab and Escape live in a keymap plugin — go through the view's prop chain so
 *  the handler's own return value (handled / fell through) is visible. */
function press(target: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key });
  return target.view.someProp('handleKeyDown', (handler) => handler(target.view, event)) === true;
}

/** Fires the idle timer and lets every chunk of a `fake` stream land. */
const settle = () => vi.advanceTimersByTimeAsync(DELAY + GAP * 10);

let editor: Editor;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  editor.destroy();
  vi.useRealTimers();
});

describe('GhostText', () => {
  it('has no suggestion until the model proposes one', () => {
    editor = makeEditor(null);
    expect(ghostSuggestion(editor.state)).toBeNull();
  });

  it('proposes a completion once the author has been idle for `delay`', async () => {
    const { provider, stream, seen } = fake(['续写', '内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    expect(stream).not.toHaveBeenCalled();

    await settle();

    expect(stream).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual({
      task: 'complete',
      text: '',
      context: '正文内容',
      locale: 'zh-CN'
    });
    // Chunks are deltas, so the widget shows everything streamed so far.
    expect(ghostSuggestion(editor.state)).toEqual({ text: '续写内容', pos: 5 });
  });

  it('omits locale when the standalone extension has none configured', async () => {
    const { provider, seen } = fake(['续写']);
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      content: CONTENT,
      extensions: [
        StarterKit,
        GhostText.configure({
          provider,
          enabled: true,
          delay: DELAY,
          minChars: 3,
          contextLength: 2000,
          hint: HINT
        })
      ]
    });

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(seen[0]?.locale).toBeUndefined();
  });

  it('draws the suggestion as a widget carrying the configured hint', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    const ghost = ghostEl(editor);
    expect(ghost).not.toBeNull();
    expect(ghost?.textContent).toContain('续写内容');
    expect(ghost?.getAttribute('contenteditable')).toBe('false');
    expect(ghost?.querySelector('.ue-ghost__hint')?.textContent).toBe(HINT);
  });

  it('keeps the suggestion out of the document, so an ignored one cannot be saved', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(ghostEl(editor)).not.toBeNull();
    expect(editor.getHTML()).toBe(CONTENT);
    expect(editor.getHTML()).not.toContain('续写内容');
  });

  it('sends no more than `contextLength` characters of preceding text', async () => {
    const { provider, seen } = fake(['续写']);
    editor = makeEditor(provider, { contextLength: 2 });

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(seen[0]?.context).toBe('内容');
  });

  it('skips chunks that carry no text yet', async () => {
    const { provider } = fake(['   ', '续写']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));

    await vi.advanceTimersByTimeAsync(DELAY + GAP);
    expect(ghostEl(editor)).toBeNull();

    await vi.advanceTimersByTimeAsync(GAP * 2);
    expect(ghostEl(editor)?.textContent).toContain('续写');
  });
});

describe('GhostText guards', () => {
  it('does not suggest for a ranged selection', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection({ from: 1, to: 4 });
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest when a node is selected instead of a cursor placed', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider, {}, `${CONTENT}<hr>`);

    editor.commands.setNodeSelection(6);
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest when the cursor is not inside a text block', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider);

    // Nothing Tiptap ships puts a cursor here — `setTextSelection` clamps to a
    // text position — but a host dispatching its own selection can. ProseMirror
    // only warns about the non-inline parent, it does not refuse the selection.
    const { doc } = editor.state;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, 0)));
    await settle();

    expect(stream).not.toHaveBeenCalled();
  });

  it('does not suggest while the AI is streaming into the document', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    // `aiStreamStart` touches neither the document nor the selection, so the idle
    // timer the cursor move just scheduled survives it and runs into the guard.
    editor.commands.aiStreamStart();
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest inside a code block', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider, {}, '<pre><code>const a = 1</code></pre>');

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest in the middle of a block', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(3);
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest until the block holds `minChars` characters', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider, { minChars: 5 });

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest when the text before the cursor is only whitespace', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider, { minChars: 0 }, '<p>&nbsp;&nbsp;&nbsp;</p>');

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(stream).not.toHaveBeenCalled();
  });

  it('does not suggest in a read-only editor', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider);

    editor.setEditable(false);
    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(stream).not.toHaveBeenCalled();
    expect(ghostEl(editor)).toBeNull();
  });

  it('does not suggest without a provider', async () => {
    editor = makeEditor(null);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
  });
});

describe('GhostText accept and dismiss', () => {
  it('inserts the suggestion into the document on Tab', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(press(editor, 'Tab')).toBe(true);
    expect(editor.getHTML()).toBe('<p>正文内容续写内容</p>');
    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
  });

  it('leaves Tab to other handlers when no suggestion is pending', () => {
    editor = makeEditor(null);

    editor.commands.setTextSelection(endOf(editor));

    expect(press(editor, 'Tab')).toBe(false);
    expect(editor.getHTML()).toBe(CONTENT);
  });

  it('discards the suggestion on Escape and leaves the document alone', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(press(editor, 'Escape')).toBe(true);
    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
    expect(editor.getHTML()).toBe(CONTENT);
  });

  it('leaves Escape to other handlers when no suggestion is pending', () => {
    editor = makeEditor(null);

    editor.commands.setTextSelection(endOf(editor));

    expect(press(editor, 'Escape')).toBe(false);
  });

  it('aborts the request on Escape, so a later chunk cannot bring the suggestion back', async () => {
    const { provider } = fake(['续写', '内容', '还有']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await vi.advanceTimersByTimeAsync(DELAY + GAP);
    expect(ghostSuggestion(editor.state)?.text).toBe('续写');

    press(editor, 'Escape');
    expect(ghostSuggestion(editor.state)).toBeNull();

    // Escape moves neither the document nor the cursor, so nothing else would
    // stop the still-running stream from painting the dismissed suggestion again.
    await settle();

    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
    expect(editor.getHTML()).toBe(CONTENT);
    expect(editor.state.selection.from).toBe(5);
  });

  it('drops the suggestion as soon as the author types', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();
    expect(ghostEl(editor)).not.toBeNull();

    editor.commands.insertContent('新');

    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
  });

  it('drops the suggestion when the cursor moves', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();
    expect(ghostEl(editor)).not.toBeNull();

    editor.commands.setTextSelection(1);

    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
  });
});

describe('GhostText runtime getters', () => {
  it('reads the idle delay when scheduling, not only when the editor is built', async () => {
    const { provider, stream } = fake(['续写']);
    let delay = 100;
    editor = makeEditor(provider, { delay: () => delay });

    editor.commands.setTextSelection(endOf(editor));
    await vi.advanceTimersByTimeAsync(20);
    expect(stream).not.toHaveBeenCalled();

    delay = 1;
    editor.commands.insertContent('。');
    await vi.advanceTimersByTimeAsync(1 + GAP * 2);

    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('reads the enabled toggle on every idle tick, so it can be flipped after mount', async () => {
    const { provider, stream } = fake(['续写']);
    let on = false;
    editor = makeEditor(provider, { enabled: () => on });

    editor.commands.setTextSelection(endOf(editor));
    await settle();
    expect(stream).not.toHaveBeenCalled();

    on = true;
    editor.commands.insertContent('。');
    await settle();

    expect(stream).toHaveBeenCalledTimes(1);
    expect(ghostEl(editor)?.textContent).toContain('续写');
  });

  it('starts suggesting once a provider arrives after the editor was built', async () => {
    const { provider, stream } = fake(['续写']);
    let current: AIProvider | null = null;
    editor = makeEditor(() => current);

    editor.commands.setTextSelection(endOf(editor));
    await settle();
    expect(stream).not.toHaveBeenCalled();

    current = provider;
    editor.commands.insertContent('。');
    await settle();

    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('abandons the scheduled request when the provider is taken away before it fires', async () => {
    const { provider, stream } = fake(['续写']);
    let current: AIProvider | null = provider;
    editor = makeEditor(() => current);

    editor.commands.setTextSelection(endOf(editor));
    // Taken away without touching the document: the timer is already ticking, so
    // only the request's own re-read can catch this.
    current = null;
    await settle();

    expect(stream).not.toHaveBeenCalled();
  });

  it('abandons the scheduled request when autocomplete is switched off before it fires', async () => {
    const { provider, stream } = fake(['续写']);
    let on = true;
    editor = makeEditor(provider, { enabled: () => on });

    editor.commands.setTextSelection(endOf(editor));
    on = false;
    await settle();

    expect(stream).not.toHaveBeenCalled();
  });
});

describe('GhostText failures', () => {
  it('stays invisible when the provider fails', async () => {
    const { provider, stream } = failing(new Error('boom'));
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(stream).toHaveBeenCalledTimes(1);
    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
    expect(editor.getHTML()).toBe(CONTENT);
  });

  it('treats a provider abort as an outcome rather than a failure', async () => {
    const { provider, stream } = failing(new AIAbortError());
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    await settle();

    expect(stream).toHaveBeenCalledTimes(1);
    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
  });

  it('drops the chunks when the cursor has moved on while the model was thinking', async () => {
    const { provider } = fake(['续写内容']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    // The request is running, but no chunk has landed yet.
    await vi.advanceTimersByTimeAsync(DELAY);
    editor.commands.setTextSelection(1);
    await settle();

    expect(ghostSuggestion(editor.state)).toBeNull();
    expect(ghostEl(editor)).toBeNull();
  });

  it('cancels the scheduled request when the editor is destroyed', async () => {
    const { provider, stream } = fake(['续写']);
    editor = makeEditor(provider);

    editor.commands.setTextSelection(endOf(editor));
    editor.destroy();
    await settle();

    expect(stream).not.toHaveBeenCalled();
  });
});
