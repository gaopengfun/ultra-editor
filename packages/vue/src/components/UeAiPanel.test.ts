import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, shallowRef, type EffectScope } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';
import {
  createTranslator,
  createUltraKit,
  type AIProvider,
  type LocaleName
} from '@ultra-editor/core';
import UeAiPanel from './UeAiPanel.vue';
import { useAi, type AIController } from '../composables/useAi';

/**
 * jsdom ships no layout engine, so `Range` has no `getClientRects` — ProseMirror's
 * `coordsAtPos` (which anchors the panel, and which `focus()` reaches on accept)
 * throws without these two.
 */
const EMPTY_RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({})
} as DOMRect;

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => EMPTY_RECT;

function provider(chunks: string[], delay = 0): AIProvider {
  return {
    async *stream(_request, signal) {
      for (const chunk of chunks) {
        if (signal.aborted) return;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        yield chunk;
      }
    }
  };
}

/**
 * A stream the test releases one chunk at a time, so "mid-generation" is a state
 * the test holds rather than races a timer for. Abort unblocks a waiting chunk and
 * ends the stream — a provider that respects `signal`, as the contract requires.
 */
function paced(chunks: string[]) {
  const gates: Array<() => void> = [];
  let consumed = 0;

  const provider: AIProvider = {
    async *stream(_request, signal) {
      for (const chunk of chunks) {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal.aborted) return;
        yield chunk;
        // Reached only when the engine pulls the next value — i.e. once it has
        // finished handling the chunk above. That is the edge `next()` waits for.
        consumed++;
      }
    }
  };

  async function next() {
    const target = consumed + 1;
    await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0), { interval: 1 });
    gates.shift()?.();
    await vi.waitFor(() => expect(consumed).toBe(target), { interval: 1 });
    await nextTick();
  }

  return { provider, next };
}

const failing = (message: string): AIProvider => ({
  async *stream() {
    throw new Error(message);
    // eslint-disable-next-line no-unreachable
    yield '';
  }
});

/** Fails the first run, succeeds the second — what a retry is for. */
function flaky(chunks: string[]): AIProvider {
  let first = true;
  return {
    async *stream() {
      if (first) {
        first = false;
        throw new Error('网络错误');
      }
      for (const chunk of chunks) yield chunk;
    }
  };
}

let scope: EffectScope;
let editor: Editor;
let controller: AIController;
let wrapper: VueWrapper;

function setup(
  options: { provider?: AIProvider | null; content?: string; locale?: LocaleName } = {}
) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({
    element,
    content: options.content ?? '<p>正文</p>',
    extensions: createUltraKit()
  });

  const locale = options.locale ?? 'zh-CN';
  const t = ref(createTranslator(locale));

  scope = effectScope();
  controller = scope.run(() =>
    useAi(shallowRef(editor), ref(options.provider ?? null), t, ref(locale), () => true)
  ) as AIController;

  wrapper = mount(UeAiPanel, {
    attachTo: document.body,
    props: { controller, t: t.value }
  });
}

/** The panel teleports to <body>, so it is never inside `wrapper.element`. */
const panel = () => document.body.querySelector<HTMLElement>('.ue-ai-panel');
const input = () => document.body.querySelector<HTMLInputElement>('.ue-ai-panel .ue-input');
const buttons = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-ai-panel .ue-btn'));
const button = (label: string) => buttons().find((entry) => entry.textContent?.trim() === label);
const labels = () => buttons().map((entry) => entry.textContent?.trim());
const bodyText = () =>
  document.body.querySelector<HTMLElement>('.ue-ai-panel__body')?.textContent?.trim();
const errorText = () =>
  document.body.querySelector<HTMLElement>('.ue-ai-panel__error')?.textContent?.trim();

async function typeInstruction(value: string) {
  const field = input();
  field!.value = value;
  field!.dispatchEvent(new Event('input'));
  await nextTick();
}

const escapeOn = (target: EventTarget) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

const settled = () => vi.waitFor(() => expect(controller.state.phase).toBe('done'));

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper.unmount();
  scope.stop();
  editor.destroy();
});

describe('closed', () => {
  it('puts nothing on the page until a task is started', () => {
    setup({ provider: provider(['ok']) });
    expect(panel()).toBeNull();
  });
});

describe('asking for an instruction', () => {
  it('asks what to write before writing anything', async () => {
    setup({ provider: provider(['结果']) });

    controller.start('write');
    await nextTick();

    expect(panel()?.getAttribute('aria-label')).toBe('AI 写一段');
    expect(input()?.placeholder).toBe('告诉 AI 你想写什么…');
    expect(document.body.querySelector('.ue-ai-panel__foot')).toBeNull();
    expect(editor.getHTML()).toBe('<p>正文</p>');
  });

  it('asks how to change the selection for a custom instruction', async () => {
    setup({ provider: provider(['结果']) });

    controller.start('custom');
    await nextTick();

    expect(input()?.placeholder).toBe('告诉 AI 你想怎么改…');
  });

  it('puts the caret straight in the instruction field', async () => {
    setup({ provider: provider(['结果']) });

    controller.start('write');
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(input());
  });

  it('refuses to run on a blank instruction', async () => {
    setup({ provider: provider(['结果']) });
    controller.start('write');
    await nextTick();

    expect(button('确定')?.disabled).toBe(true);

    await typeInstruction('   ');
    expect(button('确定')?.disabled).toBe(true);

    input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();

    expect(controller.state.phase).toBe('prompt');
  });

  it('runs the task on Enter once something is typed', async () => {
    setup({ provider: provider(['一段散文']) });
    controller.start('write');
    await nextTick();

    await typeInstruction('写一段散文');
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settled();

    expect(editor.getText()).toContain('一段散文');
  });

  it('runs the task from the confirm button too', async () => {
    setup({ provider: provider(['一段散文']) });
    controller.start('write');
    await nextTick();

    await typeInstruction('写一段散文');
    button('确定')?.click();
    await settled();

    expect(editor.getText()).toContain('一段散文');
  });

  it('closes on Escape out of the instruction field', async () => {
    setup({ provider: provider(['结果']) });
    controller.start('write');
    await nextTick();

    escapeOn(input()!);
    await nextTick();

    expect(panel()).toBeNull();
  });

  it('ignores an Escape raised elsewhere while the prompt owns the keyboard', async () => {
    setup({ provider: provider(['结果']) });
    controller.start('write');
    await nextTick();

    escapeOn(window);
    await nextTick();

    expect(panel()).not.toBeNull();
  });
});

describe('generating into the document', () => {
  it('streams the model’s words into the document as they arrive', async () => {
    const stream = paced(['第一句。', '第二句。']);
    setup({ provider: stream.provider });

    controller.start('continue');
    await stream.next();

    expect(editor.getText()).toContain('第一句。');
    expect(editor.getText()).not.toContain('第二句。');
    expect(document.body.querySelector('.ue-ai-panel__spinner')).not.toBeNull();
    expect(panel()?.textContent).toContain('AI 生成中…');
    expect(labels()).toEqual(['停止', '丢弃']);
  });

  it('locks the document while the model is writing into it', async () => {
    const stream = paced(['一段']);
    setup({ provider: stream.provider });

    controller.start('continue');
    await stream.next();
    expect(editor.isEditable).toBe(false);

    await settled();
    button('接受')?.click();
    await nextTick();

    expect(editor.isEditable).toBe(true);
  });

  it('collapses an accepted generation into a single undo step', async () => {
    setup({ provider: provider(['生', '成', '的', '内', '容']) });
    const before = editor.getHTML();

    controller.start('continue');
    await settled();
    button('接受')?.click();
    await nextTick();

    expect(editor.getHTML()).toContain('生成的内容');
    expect(panel()).toBeNull();

    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
  });

  it('aborts the run and leaves no trace when discarded mid-stream', async () => {
    const stream = paced(['一段生成中的文字', '还没写完的部分']);
    setup({ provider: stream.provider });
    const before = editor.getHTML();

    controller.start('continue');
    await stream.next();
    expect(editor.getText()).toContain('一段生成中的文字');

    button('丢弃')?.click();
    await nextTick();

    expect(editor.getHTML()).toBe(before);
    expect(panel()).toBeNull();
    expect(editor.isEditable).toBe(true);
  });

  it('leaves no trace at all when the generation is discarded', async () => {
    setup({ provider: provider(['生成的内容']) });
    const before = editor.getHTML();

    controller.start('continue');
    await settled();
    button('丢弃')?.click();
    await nextTick();

    expect(editor.getHTML()).toBe(before);
    expect(panel()).toBeNull();
    expect(editor.isEditable).toBe(true);
  });
});

describe('previewing a selection transform', () => {
  it('streams into the panel and leaves the document alone until accepted', async () => {
    setup({ provider: provider(['润色后的正文']) });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    controller.start('improve');
    await settled();

    expect(bodyText()).toBe('润色后的正文');
    expect(editor.getHTML()).toBe('<p>正文</p>');
    expect(labels()).toEqual(['重试', '丢弃', '插入到下方', '替换原文']);
  });

  it('replaces the selection with the suggestion', async () => {
    setup({ provider: provider(['润色后的正文']) });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    controller.start('improve');
    await settled();
    button('替换原文')?.click();
    await nextTick();

    expect(editor.getHTML()).toBe('<p>润色后的正文</p>');
  });

  it('drops the suggestion into a new block below instead, on request', async () => {
    setup({ provider: provider(['润色后的正文']) });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    controller.start('improve');
    await settled();
    button('插入到下方')?.click();
    await nextTick();

    expect(editor.getHTML()).toBe('<p>正文</p><p>润色后的正文</p>');
  });
});

describe('stopping', () => {
  it('keeps the partial text and raises no error when the author stops mid-stream', async () => {
    const stream = paced(['第一段。', '第二段。', '第三段。']);
    setup({ provider: stream.provider });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    controller.start('improve');
    await stream.next();
    expect(bodyText()).toBe('第一段。');

    button('停止')?.click();
    await settled();

    // Stop is an outcome, not a failure: the partial text stands and can be kept.
    expect(errorText()).toBeUndefined();
    expect(bodyText()).toBe('第一段。');
    expect(labels()).toContain('替换原文');
  });
});

describe('failing', () => {
  it('surfaces the provider’s error and offers a retry rather than an accept', async () => {
    setup({ provider: failing('模型不可用') });

    controller.start('continue');
    await vi.waitFor(() => expect(controller.state.phase).toBe('error'));

    expect(errorText()).toBe('模型不可用');
    expect(labels()).toEqual(['重试', '丢弃']);
    expect(editor.isEditable).toBe(true);
  });

  it('falls back to a generic message for an error that carries none', async () => {
    setup({ provider: failing('模型不可用') });

    controller.start('continue');
    await vi.waitFor(() => expect(controller.state.phase).toBe('error'));

    controller.state.error = '';
    await nextTick();

    expect(errorText()).toBe('AI 生成失败，请重试');
  });

  it('runs the task again from the error state', async () => {
    setup({ provider: flaky(['第二次成功']) });

    controller.start('continue');
    await vi.waitFor(() => expect(controller.state.phase).toBe('error'));

    button('重试')?.click();
    await settled();

    expect(errorText()).toBeUndefined();
    expect(editor.getText()).toContain('第二次成功');
  });

  it('reports a missing provider instead of pretending to generate', async () => {
    setup({ provider: null });

    controller.start('continue');
    await nextTick();

    expect(errorText()).toBe('未配置 AI Provider');
  });
});

describe('dismissing', () => {
  it('discards on Escape from any phase but the prompt', async () => {
    const stream = paced(['一段生成中的文字']);
    setup({ provider: stream.provider });
    const before = editor.getHTML();

    controller.start('continue');
    await stream.next();
    expect(editor.getText()).toContain('一段生成中的文字');

    escapeOn(window);
    await nextTick();

    expect(panel()).toBeNull();
    expect(editor.getHTML()).toBe(before);
  });

  it('stops listening for Escape once it is unmounted', async () => {
    setup({ provider: provider(['一段']) });
    controller.start('continue');
    await settled();

    wrapper.unmount();
    escapeOn(window);

    // The panel is gone but its controller is not: a stray Escape must not reach it.
    expect(controller.state.open).toBe(true);
  });
});

describe('titles', () => {
  it('names the panel after the task it is running', async () => {
    setup({ provider: provider(['x']) });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    controller.start('summarize');
    await settled();

    expect(panel()?.getAttribute('aria-label')).toBe('总结');
  });

  it('falls back to the generic AI title for a task it has no label for', async () => {
    setup({ provider: provider(['x']) });

    controller.start('complete');
    await settled();

    expect(panel()?.getAttribute('aria-label')).toBe('AI 助手');
  });

  it('speaks the locale it is given', async () => {
    const stream = paced(['x']);
    setup({ provider: stream.provider, locale: 'en' });

    controller.start('continue');
    await nextTick();

    expect(panel()?.textContent).toContain('Generating…');
    expect(labels()).toEqual(['Stop', 'Discard']);
  });
});
