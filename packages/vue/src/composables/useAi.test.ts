import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/vue-3';
import { effectScope, shallowRef, type EffectScope } from 'vue';
import {
  createTranslator,
  createUltraKit,
  type AIProvider,
  type AIRequest,
  type LocaleName,
  type Translator
} from '@ultra-editor/core';
import { useAi, type AIController } from './useAi';

// jsdom has no layout, so ProseMirror's coordsAtPos — which measures a DOM Range —
// has nothing to measure. Give the caret a rect the panel anchor can be read from.
let caret = { left: 120, right: 120, top: 180, bottom: 200, width: 0, height: 20 };

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => caret as DOMRect;
});

/** A provider the test drives chunk by chunk, so mid-stream states can be asserted. */
function stepProvider() {
  const pending: string[] = [];
  const requests: AIRequest[] = [];
  let wake: (() => void) | null = null;
  let failure: Error | null = null;
  let ended = false;
  let signal: AbortSignal | undefined;

  const provider: AIProvider = {
    async *stream(request, abort) {
      requests.push(request);
      signal = abort;
      abort.addEventListener('abort', () => wake?.());

      while (!ended || pending.length) {
        if (abort.aborted) return;
        if (pending.length) {
          yield pending.shift() as string;
          continue;
        }
        if (failure) throw failure;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
  };

  const resume = async () => {
    wake?.();
    wake = null;
    await tick();
  };

  return {
    provider,
    requests,
    aborted: () => signal?.aborted === true,
    emit: (chunk: string) => (pending.push(chunk), resume()),
    fail: (message: string) => ((failure = new Error(message)), resume()),
    end: () => ((ended = true), resume())
  };
}

function failingProvider(message: string): AIProvider {
  return {
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error(message);
    }
  };
}

/** Drain the microtasks the engine and the generator hand back and forth. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const t = createTranslator('zh-CN');

let scopes: EffectScope[] = [];

function harness(content: string, ai: AIProvider | null = null) {
  const element = document.createElement('div');
  document.body.appendChild(element);

  const editor = shallowRef<Editor | undefined>(
    new Editor({ element, content, extensions: createUltraKit() })
  );
  const provider = shallowRef<AIProvider | null>(ai);
  const locale = shallowRef<LocaleName>('zh-CN');
  const editable = shallowRef(true);
  const scope = effectScope();
  scopes.push(scope);

  const controller = scope.run(() =>
    useAi(editor, provider, shallowRef<Translator>(t), locale, () => editable.value)
  ) as AIController;

  return {
    ai: controller,
    state: controller.state,
    editor,
    provider,
    locale,
    editable,
    scope,
    html: () => editor.value?.getHTML() ?? '',
    select: (from: number, to?: number) =>
      editor.value?.commands.setTextSelection(to === undefined ? from : { from, to })
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  caret = { left: 120, right: 120, top: 180, bottom: 200, width: 0, height: 20 };
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
});

afterEach(() => {
  scopes.forEach((scope) => scope.stop());
  scopes = [];
  vi.unstubAllGlobals();
});

describe('useAi — writing into the document', () => {
  it('streams the model output into the document as it arrives', async () => {
    const step = stepProvider();
    const { ai, state, html } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    expect(state.mode).toBe('insert');
    expect(state.phase).toBe('running');

    await step.emit('第一');
    expect(state.text).toBe('第一');
    expect(html()).toContain('第一');

    await step.emit('段');
    expect(state.text).toBe('第一段');
    expect(html()).toBe('<p>正文</p><p>第一段</p>');

    await step.end();
    expect(state.phase).toBe('done');
  });

  it('replays an accepted generation as a single undo step', async () => {
    const step = stepProvider();
    const { ai, editor, html } = harness('<p>正文</p>', step.provider);
    const before = html();

    ai.start('continue');
    await step.emit('第一');
    await step.emit('段');
    await step.end();
    ai.accept();

    expect(html()).toBe('<p>正文</p><p>第一段</p>');

    editor.value?.commands.undo();
    expect(html()).toBe(before);
  });

  it('leaves no trace in the document when the generation is discarded', async () => {
    const step = stepProvider();
    const { ai, state, editor, html } = harness('<p>正文</p>', step.provider);
    const before = html();

    ai.start('continue');
    await step.emit('不想要的内容');
    ai.discard();

    expect(html()).toBe(before);
    expect(step.aborted()).toBe(true);
    expect(state.open).toBe(false);
    expect(state.text).toBe('');

    // Nothing reached the history stack either.
    editor.value?.commands.undo();
    expect(html()).toBe(before);
  });

  it('keeps the partial text when the user hits stop', async () => {
    const step = stepProvider();
    const { ai, state, html } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    await step.emit('写了一半');
    ai.stop();
    await tick();

    expect(step.aborted()).toBe(true);
    expect(state.phase).toBe('done');
    expect(state.error).toBe('');
    expect(state.text).toBe('写了一半');
    expect(html()).toContain('写了一半');

    // The half-written passage is still the user's to keep.
    ai.accept();
    expect(html()).toBe('<p>正文</p><p>写了一半</p>');
  });

  it('locks the document while the model writes into it', async () => {
    const step = stepProvider();
    const { ai, editor } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    expect(editor.value?.isEditable).toBe(false);

    await step.emit('内容');
    await step.end();
    ai.accept();

    expect(editor.value?.isEditable).toBe(true);
  });

  it('unlocks to what the host wants now, not to what was true when it locked', async () => {
    const step = stepProvider();
    const { ai, editor, editable } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    editable.value = false;
    await step.end();
    ai.discard();

    expect(editor.value?.isEditable).toBe(false);
  });

  it('anchors the panel just under the caret', () => {
    const step = stepProvider();
    const { ai, state } = harness('<p>正文</p>', step.provider);

    ai.start('continue');

    expect(state.anchor).toEqual({ x: 120, y: 208 });
  });

  it('keeps the panel on screen when the caret sits at the far edge of the viewport', () => {
    caret = { left: 990, right: 990, top: 770, bottom: 790, width: 0, height: 20 };
    const step = stepProvider();
    const { ai, state } = harness('<p>正文</p>', step.provider);

    ai.start('continue');

    // 1000 − 560 panel − 16 margin, and 800 − 240 panel − 16 margin.
    expect(state.anchor).toEqual({ x: 424, y: 544 });
  });

  // A caret scrolled above the fold reports coordinates outside the viewport.
  it('keeps the panel clear of the top-left margin when the caret is off-screen', () => {
    caret = { left: -40, right: -40, top: -120, bottom: -100, width: 0, height: 20 };
    const step = stepProvider();
    const { ai, state } = harness('<p>正文</p>', step.provider);

    ai.start('continue');

    expect(state.anchor).toEqual({ x: 16, y: 16 });
  });

  it('writes a second generation into the same streaming region instead of opening another', async () => {
    const first = stepProvider();
    const { ai, provider, html } = harness('<p>正文</p>', first.provider);

    ai.start('continue');
    await first.emit('第一次');

    const second = stepProvider();
    provider.value = second.provider;
    ai.start('continue');
    await second.emit('第二次');
    await second.end();
    ai.accept();

    expect(html()).toBe('<p>正文</p><p>第二次</p>');

    // Whatever the abandoned run says now, it can no longer reach the document.
    await first.emit('迟到的第一次');
    expect(html()).toBe('<p>正文</p><p>第二次</p>');
  });

  it('aborts the running generation when a second one starts, rather than orphaning it', async () => {
    const first = stepProvider();
    const { ai, provider } = harness('<p>正文</p>', first.provider);

    ai.start('continue');
    await first.emit('第一次');
    expect(first.aborted()).toBe(false);

    const second = stepProvider();
    provider.value = second.provider;
    ai.start('continue');

    // Nobody is watching the first stream any more, and a stream nobody watches
    // still bills for every token it pulls.
    expect(first.aborted()).toBe(true);
  });

  it('stays in the running phase while a retried generation streams', async () => {
    const step = stepProvider();
    const { ai, state } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    await step.emit('第一次');

    ai.retry();
    await step.emit('第二次');

    // The abandoned run's abort resolves a microtask after retry has already set
    // `running`, so its onAbort used to flip the panel to `done` — showing accept
    // and discard on a generation that was still streaming.
    expect(state.phase).toBe('running');
  });
});

describe('useAi — transforming a selection', () => {
  it('streams a transform into the panel and leaves the document alone', async () => {
    const step = stepProvider();
    const { ai, state, editor, select, html } = harness('<p>第一段落</p>', step.provider);
    const before = html();

    select(1, 5);
    ai.start('improve');
    expect(state.mode).toBe('transform');

    await step.emit('改写后的');
    expect(state.text).toBe('改写后的');
    expect(html()).toBe(before);
    // The author keeps writing while the suggestion streams; only insert mode locks.
    expect(editor.value?.isEditable).toBe(true);

    await step.end();
  });

  it('sends the selected text, the locale and the instruction to the provider', async () => {
    const step = stepProvider();
    const { ai, state, locale, select } = harness('<p>第一段落</p><p>第二段落</p>', step.provider);
    locale.value = 'en';

    select(7, 11);
    ai.start('changeTone');
    state.instruction = '正式';
    ai.submit();

    expect(step.requests[0]).toMatchObject({
      task: 'changeTone',
      text: '第二段落',
      instruction: '正式',
      locale: 'en'
    });
    expect(step.requests[0].context).toContain('第一段落');

    await step.end();
  });

  it('sends the text before the cursor, not a selection, to a continuation', async () => {
    const step = stepProvider();
    const { ai, select } = harness('<p>第一段落</p>', step.provider);

    select(5);
    ai.start('continue');

    expect(step.requests[0]).toMatchObject({ task: 'continue', text: '', instruction: undefined });
    expect(step.requests[0].context).toContain('第一段落');

    await step.end();
  });

  it('waits for an instruction before running the tasks that need one', async () => {
    const step = stepProvider();
    const { ai, state, select } = harness('<p>第一段落</p>', step.provider);

    select(1, 5);
    ai.start('translate');
    expect(state.phase).toBe('prompt');
    expect(step.requests).toHaveLength(0);

    ai.submit();
    state.instruction = '   ';
    ai.submit();
    expect(step.requests).toHaveLength(0);
    expect(state.phase).toBe('prompt');

    state.instruction = '英文';
    ai.submit();

    expect(state.phase).toBe('running');
    expect(step.requests).toHaveLength(1);

    await step.end();
  });

  it('replaces only the selected words, without tearing the paragraph in three', async () => {
    const step = stepProvider();
    const { ai, select, html } = harness('<p>第一段落</p>', step.provider);

    select(2, 4);
    ai.start('improve');
    await step.emit('壹贰');
    await step.end();
    ai.accept();

    expect(html()).toBe('<p>第壹贰落</p>');
  });

  it('turns a multi-line suggestion into hard breaks when it lands inside a paragraph', async () => {
    const step = stepProvider();
    const { ai, select, html } = harness('<p>第一段落</p>', step.provider);

    select(2, 4);
    ai.start('improve');
    await step.emit('第一行\n第二行');
    await step.end();
    ai.accept();

    expect(html()).toBe('<p>第第一行<br>第二行落</p>');
  });

  it('writes the suggestion back as paragraphs when the selection fills the block', async () => {
    const step = stepProvider();
    const { ai, select, html } = harness('<p>第一段落</p>', step.provider);

    select(1, 5);
    ai.start('improve');
    await step.emit('第一段\n\n第二段');
    await step.end();
    ai.accept();

    expect(html()).toBe('<p>第一段</p><p>第二段</p>');
  });

  it('puts the suggestion in a new block below rather than inside the host paragraph', async () => {
    const step = stepProvider();
    const { ai, select, html } = harness('<p>第一段落</p>', step.provider);

    select(2, 4);
    ai.start('improve');
    await step.emit('补充说明');
    await step.end();
    ai.accept('below');

    expect(html()).toBe('<p>第一段落</p><p>补充说明</p>');
  });

  it('places the suggestion after a node selection instead of inside it', async () => {
    const step = stepProvider();
    const { ai, editor, html } = harness('<p>正文</p><hr><p>结尾</p>', step.provider);

    editor.value?.commands.setNodeSelection(4);
    ai.start('improve');
    await step.emit('新的段落');
    await step.end();
    ai.accept('below');

    expect(html()).toBe('<p>正文</p><hr><p>新的段落</p><p>结尾</p>');
  });

  it('follows edits made while it streams, so accept still replaces the right words', async () => {
    const step = stepProvider();
    const { ai, editor, select, html } = harness('<p>第一段落</p>', step.provider);

    select(2, 4);
    ai.start('improve');
    await step.emit('壹贰');

    // The author is free to keep typing — the captured range has to ride along.
    editor.value?.commands.insertContentAt(1, '前缀');
    editor.value?.commands.setTextSelection(1);
    await step.end();
    ai.accept();

    expect(html()).toBe('<p>前缀第壹贰落</p>');
  });

  it('discards a transform without touching the document', async () => {
    const step = stepProvider();
    const { ai, state, select, html } = harness('<p>第一段落</p>', step.provider);
    const before = html();

    select(1, 5);
    ai.start('improve');
    await step.emit('改写后的');
    ai.discard();

    expect(html()).toBe(before);
    expect(step.aborted()).toBe(true);
    expect(state.open).toBe(false);
  });

  it('closes the panel without an edit when the model returned nothing', async () => {
    const step = stepProvider();
    const { ai, state, select, html } = harness('<p>第一段落</p>', step.provider);
    const before = html();

    select(1, 5);
    ai.start('improve');
    await step.end();
    ai.accept();

    expect(html()).toBe(before);
    expect(state.open).toBe(false);
  });

  it('stops following edits once the editor it was watching is gone', async () => {
    const step = stepProvider();
    const { ai, editor, select, html } = harness('<p>第一段落</p>', step.provider);
    const instance = editor.value as Editor;

    select(2, 4);
    ai.start('improve');
    await step.emit('壹贰');

    editor.value = undefined;
    ai.discard();
    editor.value = instance;
    instance.commands.insertContentAt(1, '前缀');

    expect(html()).toBe('<p>前缀第一段落</p>');
  });
});

describe('useAi — retrying and failing', () => {
  it('throws the previous attempt away, document and all, and runs again', async () => {
    const first = stepProvider();
    const { ai, provider, html } = harness('<p>正文</p>', first.provider);

    ai.start('continue');
    await first.emit('第一次');
    expect(html()).toContain('第一次');

    const second = stepProvider();
    provider.value = second.provider;
    ai.retry();

    expect(first.aborted()).toBe(true);
    expect(html()).toBe('<p>正文</p>');

    await second.emit('第二次');
    await second.end();
    ai.accept();

    expect(html()).toBe('<p>正文</p><p>第二次</p>');
  });

  it('retries a transform without leaving the old suggestion in the panel', async () => {
    const first = stepProvider();
    const { ai, state, provider, select, html } = harness('<p>第一段落</p>', first.provider);

    select(2, 4);
    ai.start('improve');
    await first.emit('壹贰');

    const second = stepProvider();
    provider.value = second.provider;
    ai.retry();

    expect(first.aborted()).toBe(true);
    expect(state.text).toBe('');

    await second.emit('叁肆');
    await second.end();
    ai.accept();

    expect(html()).toBe('<p>第叁肆落</p>');
  });

  it('retries from scratch when there is no previous attempt to throw away', async () => {
    const step = stepProvider();
    const { ai, state } = harness('<p>正文</p>', step.provider);

    ai.retry();

    expect(state.phase).toBe('running');
    expect(step.requests[0]).toMatchObject({ task: 'continue', text: '', context: '' });

    await step.end();
  });

  it('surfaces a failed generation and rolls the document back', async () => {
    const { ai, state, editor, html } = harness('<p>正文</p>', failingProvider('模型炸了'));
    const before = html();

    ai.start('continue');
    await tick();

    expect(state.phase).toBe('error');
    expect(state.error).toBe('模型炸了');
    expect(html()).toBe(before);
    expect(editor.value?.isEditable).toBe(true);
  });

  it('surfaces a failed transform without touching the document', async () => {
    const { ai, state, select, html } = harness('<p>第一段落</p>', failingProvider('模型炸了'));
    const before = html();

    select(1, 5);
    ai.start('improve');
    await tick();

    expect(state.phase).toBe('error');
    expect(state.error).toBe('模型炸了');
    expect(html()).toBe(before);
  });

  it('falls back to a generic message when the failure carries none', async () => {
    const { ai, state } = harness('<p>正文</p>', failingProvider(''));

    ai.start('continue');
    await tick();

    expect(state.error).toBe(t('ai.failed'));
  });

  it('reports a missing provider instead of throwing', () => {
    const { ai, state, html } = harness('<p>正文</p>', null);
    const before = html();

    ai.start('continue');

    expect(state.phase).toBe('error');
    expect(state.error).toBe(t('ai.noProvider'));
    expect(state.open).toBe(true);
    expect(html()).toBe(before);
  });
});

describe('useAi — nothing to work with', () => {
  it('does nothing at all when there is no editor', () => {
    const step = stepProvider();
    const { ai, state, editor } = harness('<p>正文</p>', step.provider);
    editor.value = undefined;

    ai.start('improve');

    expect(state.open).toBe(false);
    expect(step.requests).toHaveLength(0);
  });

  it('ignores stop and discard when nothing is running', () => {
    const step = stepProvider();
    const { ai, state, html } = harness('<p>正文</p>', step.provider);
    const before = html();

    ai.stop();
    ai.discard();

    expect(html()).toBe(before);
    expect(state.open).toBe(false);
  });

  it('never throws when the editor is unmounted mid-generation', async () => {
    const step = stepProvider();
    const { ai, state, editor } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    await step.emit('第一');

    editor.value = undefined;
    await step.emit('第二');
    expect(state.text).toBe('第一第二');

    await step.fail('模型炸了');
    expect(state.phase).toBe('error');
    expect(state.error).toBe('模型炸了');

    ai.retry();
    expect(state.error).toBe(t('ai.noProvider'));

    expect(() => ai.accept()).not.toThrow();
  });

  it('aborts a running generation when the scope is disposed', async () => {
    const step = stepProvider();
    const { ai, scope } = harness('<p>正文</p>', step.provider);

    ai.start('continue');
    await step.emit('写了一半');
    scope.stop();
    await tick();

    expect(step.aborted()).toBe(true);
  });
});
