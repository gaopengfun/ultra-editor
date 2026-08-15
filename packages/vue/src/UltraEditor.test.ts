import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import type { Editor } from '@tiptap/vue-3';
import { createLowlight } from '@ultra-editor/core/lean';
import {
  DEFAULT_SLASH_ITEMS,
  type AIProvider,
  type AITask,
  type UploadError
} from '@ultra-editor/core';
import UltraEditor from './UltraEditor.vue';
import type { UltraEditorProps } from './types';

/**
 * jsdom ships no layout engine, so `Range` has no `getClientRects` at all. Tiptap's
 * `focus()` scrolls the selection into view an animation frame later, which walks
 * into ProseMirror's `coordsAtPos` — without this every `.chain().focus()` throws
 * inside a requestAnimationFrame.
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

/** `@tiptap/vue-3` publishes editor state two animation frames after a transaction. */
async function flush() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await nextTick();
}

function provider(chunks: string[]): AIProvider {
  return {
    async *stream(_request, signal) {
      for (const chunk of chunks) {
        if (signal.aborted) return;
        yield chunk;
      }
    }
  };
}

/** A stream the test releases chunk by chunk, so "mid-generation" is never a race. */
function paced(chunks: string[]) {
  const gates: Array<() => void> = [];
  let consumed = 0;

  const source: AIProvider = {
    async *stream(_request, signal) {
      for (const chunk of chunks) {
        await new Promise<void>((resolve) => {
          gates.push(resolve);
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        if (signal.aborted) return;
        yield chunk;
        consumed++;
      }
    }
  };

  async function next() {
    const target = consumed + 1;
    await vi.waitFor(() => expect(gates.length).toBeGreaterThan(0), { interval: 1 });
    gates.shift()?.();
    await vi.waitFor(() => expect(consumed).toBe(target), { interval: 1 });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await nextTick();
  }

  return { provider: source, next };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface EditorApi {
  editor: Editor;
  getHTML: () => string;
  getText: () => string;
  getJSON: () => Record<string, unknown>;
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
  setContent: (html: string) => void;
  focus: () => void;
  clear: () => void;
  runAI: (task: AITask) => void;
}

let wrapper: VueWrapper;
let editor: Editor;

async function mountEditor(props: Partial<UltraEditorProps> = {}) {
  wrapper = mount(UltraEditor, {
    attachTo: document.body,
    props: { modelValue: '<p>正文</p>', ...props }
  });
  await nextTick();
  editor = api().editor;
  return wrapper;
}

const api = () => wrapper.vm as unknown as EditorApi;

/* DOM helpers — menus, dialogs and toasts all teleport to <body>. */
const toolbarButton = (title: string) => wrapper.get(`.ue-toolbar button[title="${title}"]`);
/** `get` throws when the button is missing, so asking whether it is there needs `find`. */
const findToolbarButton = (title: string) => wrapper.find(`.ue-toolbar button[title="${title}"]`);
const menuItem = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-menu .ue-menu__item')).find(
    (entry) => entry.textContent?.trim() === label
  );
const dialogButton = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-dialog__footer .ue-btn')).find(
    (entry) => entry.textContent?.trim() === label
  );
const panelButton = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-ai-panel .ue-btn')).find(
    (entry) => entry.textContent?.trim() === label
  );
const toasts = () =>
  Array.from(document.body.querySelectorAll('.ue-toast')).map((toast) => toast.textContent?.trim());
const statusbar = () => wrapper.get('.ue-statusbar').text();

/**
 * jsdom implements no `elementFromPoint`, which ProseMirror's `posAtCoords` needs,
 * so the document position under the pointer has to be supplied by the test.
 */
function pointAt(pos: number | null, inside = pos ?? -1) {
  vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(pos === null ? null : { pos, inside });
}

function rightClick(target: Element) {
  target.dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 })
  );
}

/** Position of the first node of a given type. */
function posOf(type: string) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos;
  });
  return found;
}

/** Languages the mounted editor's code block currently offers. */
function languagesOf(): string[] {
  const codeBlock = editor.extensionManager.extensions.find(
    (extension) => extension.name === 'codeBlock'
  )!;
  return (codeBlock.options.lowlight as { listLanguages: () => string[] }).listLanguages();
}

/**
 * The default grammars arrive through a real `import()`, which settles over
 * several ticks rather than one — `flushPromises` is not enough to see it land.
 */
const whenLanguagesLoaded = () =>
  vi.waitFor(() => expect(languagesOf().length).toBeGreaterThan(30));

function cellPositions() {
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') cells.push(pos);
  });
  return cells;
}

const TABLE =
  '<table><tbody><tr><th><p>甲</p></th><th><p>乙</p></th></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>';
const IMAGE = '<p>正文</p><img src="/a.png">';

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper.unmount();
  vi.restoreAllMocks();
  // A test that fails before its own `useRealTimers` would otherwise leave fake
  // timers installed and time out every test after it.
  vi.useRealTimers();
});

describe('chrome', () => {
  it('mounts an editable surface with a toolbar and a status bar', async () => {
    await mountEditor();

    expect(wrapper.find('.ue-toolbar').exists()).toBe(true);
    expect(wrapper.find('.ue-statusbar').exists()).toBe(true);
    expect(wrapper.get('.ue-content').attributes('contenteditable')).toBe('true');
    expect(wrapper.get('.ultra-editor').classes()).not.toContain('ultra-editor--readonly');
    expect(editor.getHTML()).toBe('<p>正文</p>');
  });

  it('fetches the common languages after mount instead of bundling them', async () => {
    await mountEditor();

    // Nothing is registered while the editor is being built — the grammars are a
    // chunk of their own, so an app that never shows a code block never gets them.
    expect(languagesOf().length).toBe(0);

    await whenLanguagesLoaded();

    // Once they land the picker has a real catalogue rather than a lone entry.
    const languages = languagesOf();
    expect(languages).toContain('typescript');
    expect(languages).toContain('python');
    expect(languages).toContain('json');
  });

  it('leaves a host-supplied lowlight instance exactly as it was given', async () => {
    const lowlight = createLowlight();
    lowlight.register('custom', (() => ({ name: 'custom', contains: [] })) as never);
    await mountEditor({ lowlight });

    await flushPromises();
    await flushPromises();

    // A host that brings its own instance owns the language set: no fetch, and
    // nothing added behind its back.
    expect(languagesOf()).toEqual(['custom']);
  });

  it('drops the toolbar when the host turns it off', async () => {
    await mountEditor({ toolbar: false });
    expect(wrapper.find('.ue-toolbar').exists()).toBe(false);
  });

  it('drops the status bar when the host turns it off', async () => {
    await mountEditor({ statusbar: false });
    expect(wrapper.find('.ue-statusbar').exists()).toBe(false);
  });

  it('takes away every editing surface in read-only mode', async () => {
    await mountEditor({ editable: false });

    expect(wrapper.get('.ultra-editor').classes()).toContain('ultra-editor--readonly');
    expect(wrapper.find('.ue-toolbar').exists()).toBe(false);
    expect(wrapper.get('.ue-content').attributes('contenteditable')).toBe('false');

    // The bubble menu goes with it — none of its actions could be applied.
    editor.view.dom.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await nextTick();
    expect(document.body.querySelector('.ue-bubble')).toBeNull();
  });

  it('switches an editor to read-only after the fact', async () => {
    await mountEditor();
    expect(editor.isEditable).toBe(true);

    await wrapper.setProps({ editable: false });

    expect(editor.isEditable).toBe(false);
    expect(wrapper.find('.ue-toolbar').exists()).toBe(false);
  });

  it('hands the height bounds to the stylesheet as custom properties', async () => {
    await mountEditor({ minHeight: '360px', maxHeight: '720px' });

    const style = wrapper.get('.ultra-editor').attributes('style');
    expect(style).toContain('--ue-min-height: 360px');
    expect(style).toContain('--ue-max-height: 720px');
  });

  it('shows the host’s placeholder on an empty document', async () => {
    await mountEditor({ modelValue: '', placeholder: '写点什么…' });

    expect(wrapper.get('.ue-content p').attributes('data-placeholder')).toBe('写点什么…');
  });

  it('updates the placeholder after the editor was built', async () => {
    await mountEditor({ modelValue: '', placeholder: '第一版' });

    await wrapper.setProps({ placeholder: '第二版' });
    editor.view.dispatch(editor.state.tr.setMeta('refresh-placeholder', true));
    await nextTick();

    expect(wrapper.get('.ue-content p').attributes('data-placeholder')).toBe('第二版');
  });

  it('puts the caret in the document when asked to autofocus', async () => {
    await mountEditor({ autofocus: true });
    await vi.waitFor(() => expect(editor.view.hasFocus()).toBe(true));
  });

  it('leaves the caret out of the document by default', async () => {
    await mountEditor();
    expect(editor.view.hasFocus()).toBe(false);
  });
});

describe('two-way binding', () => {
  it('emits the document on every edit', async () => {
    await mountEditor();

    editor.commands.insertContent('新增');
    await nextTick();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['<p>新增正文</p>']);
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['<p>新增正文</p>']);
  });

  it('stays quiet when the arriving grammars repaint the code blocks', async () => {
    const html = '<pre><code class="language-python">x = 1</code></pre>';
    await mountEditor({ modelValue: html });

    // The repaint is the point: wait for the block to actually be highlighted.
    await vi.waitFor(() =>
      expect(wrapper.get('.ue-content').find('.hljs-number').exists()).toBe(true)
    );

    // Registering the languages forces a pass through the document, which the
    // host must not see as an edit — a pristine draft would come up dirty, and
    // the trailing-node plugin must not slip a paragraph in behind its back.
    expect(wrapper.emitted('change')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(editor.getHTML()).toBe(html);
  });

  it('takes content pushed in through the model', async () => {
    await mountEditor();

    await wrapper.setProps({ modelValue: '<h2>新的标题</h2>' });

    expect(editor.getHTML()).toContain('<h2>新的标题</h2>');
  });

  it('empties the document when the model is emptied', async () => {
    await mountEditor();

    await wrapper.setProps({ modelValue: '' });

    expect(editor.getHTML()).toBe('<p></p>');
  });

  it('ignores the parent echoing our own edit back at us', async () => {
    await mountEditor();
    editor.commands.insertContent('新增');
    await nextTick();

    const echoed = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as string;
    editor.commands.setTextSelection(2);
    await wrapper.setProps({ modelValue: echoed });

    // A setContent here would reset the caret and re-emit; neither may happen.
    expect(editor.state.selection.from).toBe(2);
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('ignores a model that already matches the document', async () => {
    await mountEditor({ modelValue: '' });

    await wrapper.setProps({ modelValue: '<p></p>' });

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('holds the emit back until the debounce window closes', async () => {
    await mountEditor({ debounce: 40 });
    const serialize = vi.spyOn(editor, 'getHTML');

    editor.commands.insertContent('一');
    editor.commands.insertContent('二');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(serialize).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(serialize).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['<p>一二正文</p>']);
  });

  it('flushes a pending debounced edit on unmount rather than losing it', async () => {
    await mountEditor({ debounce: 5000 });

    editor.commands.insertContent('临别一笔');
    await nextTick();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    wrapper.unmount();

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['<p>临别一笔正文</p>']);
  });

  it('cancels a stale debounced edit when the parent replaces the document', async () => {
    await mountEditor({ debounce: 5000 });
    editor.commands.insertContent('本地旧内容');
    await nextTick();

    await wrapper.setProps({ modelValue: '<p>外部新内容</p>' });
    expect(editor.getHTML()).toBe('<p>外部新内容</p>');

    wrapper.unmount();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('change')).toBeUndefined();
  });
});

describe('lifecycle', () => {
  it('destroys the ProseMirror view on unmount, leaking no editor', async () => {
    await mountEditor();
    expect(editor.isDestroyed).toBe(false);

    wrapper.unmount();

    expect(editor.isDestroyed).toBe(true);
  });
});

describe('public API', () => {
  it('hands out the document in every shape the host might want', async () => {
    await mountEditor({ modelValue: '<p>正文</p>' });

    expect(api().getHTML()).toBe('<p>正文</p>');
    expect(api().getText()).toBe('正文');
    expect(api().getJSON()).toMatchObject({ type: 'doc' });
    expect(api().editor.getHTML()).toBe('<p>正文</p>');
  });

  it('replaces the document on demand', async () => {
    await mountEditor();

    api().setContent('<h2>换掉</h2>');
    await nextTick();

    expect(editor.getHTML()).toContain('<h2>换掉</h2>');
  });

  it('empties the document when handed nothing to set', async () => {
    await mountEditor();

    api().setContent('');
    await nextTick();

    expect(editor.getHTML()).toBe('<p></p>');
  });

  it('empties the document on demand, and says so', async () => {
    await mountEditor();

    api().clear();
    await nextTick();

    expect(editor.getHTML()).toBe('<p></p>');
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['<p></p>']);
  });

  it('focuses the document on demand', async () => {
    await mountEditor();

    api().focus();
    await vi.waitFor(() => expect(editor.view.hasFocus()).toBe(true));
  });

  it('runs an AI task on demand', async () => {
    await mountEditor({ ai: { provider: provider(['生成的内容']) } });

    api().runAI('continue');
    await vi.waitFor(() => expect(editor.getText()).toContain('生成的内容'));

    expect(document.body.querySelector('.ue-ai-panel')).not.toBeNull();
  });

  it('hands out and takes back the document as markdown', async () => {
    await mountEditor({ modelValue: '<h1>标题</h1><p><strong>粗</strong></p>' });

    expect(api().getMarkdown()).toBe('# 标题\n\n**粗**');

    api().setMarkdown('## 新标题\n\n- 一');
    await nextTick();

    // Tiptap parks a paragraph after a document that ends in a list, so there is
    // somewhere to keep writing. It carries no text, so it serialises back to
    // nothing and the Markdown round trip stays put.
    expect(editor.getHTML()).toBe('<h2>新标题</h2><ul><li><p>一</p></li></ul><p></p>');
    expect(api().getMarkdown()).toBe('## 新标题\n\n- 一');
  });
});

describe('markdown source mode', () => {
  const sourceToggle = () => wrapper.find('.ue-toolbar button[title="Markdown 源码"]');
  const exitButton = () => wrapper.find('.ue-toolbar button[title="退出 Markdown 源码"]');
  const textarea = () => wrapper.find<HTMLTextAreaElement>('textarea.ue-markdown');

  it('swaps the document for its markdown, and back again', async () => {
    await mountEditor({ modelValue: '<h1>标题</h1><p>正文</p>' });

    await sourceToggle().trigger('click');

    expect(textarea().exists()).toBe(true);
    expect(textarea().element.value).toBe('# 标题\n\n正文');
    // In source mode the textarea is the document, so that is what the API hands back.
    expect(api().getMarkdown()).toBe('# 标题\n\n正文');
    // The editing surface is hidden rather than destroyed, so the document — and
    // its undo history — is still there to come back to.
    expect(wrapper.find('.ue-editor').isVisible()).toBe(false);

    await exitButton().trigger('click');

    expect(textarea().exists()).toBe(false);
    expect(wrapper.find('.ue-editor').isVisible()).toBe(true);
  });

  it('applies what was typed in the textarea to the document', async () => {
    await mountEditor({ modelValue: '<p>正文</p>' });
    await sourceToggle().trigger('click');

    await textarea().setValue('## 改过了\n\n- 一\n- 二');
    await exitButton().trigger('click');

    expect(editor.getHTML()).toBe(
      '<h2>改过了</h2><ul><li><p>一</p></li><li><p>二</p></li></ul><p></p>'
    );
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([editor.getHTML()]);
  });

  it('keeps the model honest while the textarea is still open', async () => {
    vi.useFakeTimers();
    await mountEditor({ modelValue: '<p>正文</p>' });
    await sourceToggle().trigger('click');

    await textarea().setValue('# 边写边同步');
    await vi.advanceTimersByTimeAsync(400);

    // A host reading v-model mid-edit gets the document the Markdown describes,
    // not the one from before the author switched into source mode.
    expect(editor.getHTML()).toBe('<h1>边写边同步</h1><p></p>');
  });

  it('drops the pending apply when the author leaves source mode', async () => {
    vi.useFakeTimers();
    await mountEditor({ modelValue: '<p>正文</p>' });
    await sourceToggle().trigger('click');

    await textarea().setValue('# 源码写的');
    // Leave while the debounce is still pending, then carry on typing in the
    // document. The timer the textarea scheduled must not come back and revert it.
    await vi.advanceTimersByTimeAsync(100);
    await exitButton().trigger('click');
    editor.commands.setContent('<p>退出后新写的</p>');

    await vi.advanceTimersByTimeAsync(500);
    expect(editor.getHTML()).toBe('<p>退出后新写的</p>');
  });

  it('leaves the document alone when the author changed nothing', async () => {
    // The list is what makes this bite: `markdownToHTML` writes a tight
    // `<li>一</li>` where ProseMirror writes `<li><p>一</p></li>`, so comparing
    // the two HTML strings never matched and the write always went through.
    await mountEditor({ modelValue: '<ul><li><p>一</p></li><li><p>二</p></li></ul><p>正文</p>' });
    const before = editor.getHTML();
    expect(editor.can().undo()).toBe(false);

    await sourceToggle().trigger('click');
    await exitButton().trigger('click');

    // Looking at the source is not editing it. Rewriting the document with the
    // content it already had produces a transaction all the same, and that
    // transaction is what the author's next Ctrl+Z lands on — undoing nothing
    // visible instead of the edit they meant to take back.
    expect(editor.getHTML()).toBe(before);
    expect(editor.can().undo()).toBe(false);
  });

  it('shows only the way out while the textarea is open', async () => {
    await mountEditor();
    await sourceToggle().trigger('click');

    // Every other control acts on a document that is not on screen.
    expect(findToolbarButton('加粗').exists()).toBe(false);
    expect(exitButton().exists()).toBe(true);
  });

  it('does not throw the markdown away when unmounted from source mode', async () => {
    await mountEditor({ modelValue: '<p>正文</p>' });
    await sourceToggle().trigger('click');
    await textarea().setValue('# 未退出就卸载');

    wrapper.unmount();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['<h1>未退出就卸载</h1><p></p>']);
  });

  it('takes markdown handed to it while the textarea is open', async () => {
    await mountEditor({ modelValue: '<p>正文</p>' });
    await sourceToggle().trigger('click');

    api().setMarkdown('# 从外面塞进来');
    await nextTick();

    // The textarea is what the author is looking at, so it has to move too.
    expect(textarea().element.value).toBe('# 从外面塞进来');
    expect(editor.getHTML()).toBe('<h1>从外面塞进来</h1><p></p>');
  });

  it('converts pasted markdown in the document', async () => {
    await mountEditor({ modelValue: '<p></p>' });

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? '## 粘贴来的' : '') }
    });
    editor.view.dom.dispatchEvent(event);

    expect(editor.getHTML()).toContain('<h2>粘贴来的</h2>');
  });

  it('is absent when the host turns markdown off', async () => {
    await mountEditor({ markdown: false });

    expect(sourceToggle().exists()).toBe(false);
  });

  it('leaves a paste alone when the host turns markdown off', async () => {
    await mountEditor({ modelValue: '<p></p>', markdown: false });

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => (type === 'text/plain' ? '## 粘贴来的' : '') }
    });
    editor.view.dom.dispatchEvent(event);

    expect(editor.getHTML()).not.toContain('<h2>');
  });
});

describe('word count', () => {
  it('counts CJK characters and Latin words separately', async () => {
    await mountEditor({ modelValue: '<p>你好 hello world</p>' });
    await flush();

    // 2 CJK characters + 2 Latin words; 12 non-whitespace characters.
    expect(statusbar()).toContain('4 字');
    expect(statusbar()).toContain('12 字符');
  });

  it('follows the document as it is edited', async () => {
    await mountEditor({ modelValue: '<p></p>' });
    await flush();
    expect(statusbar()).toContain('0 字');

    editor.commands.insertContent('三个字');
    await flush();

    expect(statusbar()).toContain('3 字');
  });
});

describe('locale and messages', () => {
  it('labels the whole chrome in the locale it is given', async () => {
    await mountEditor({ locale: 'en', modelValue: '<p>hi</p>' });
    await flush();

    expect(findToolbarButton('Bold').exists()).toBe(true);
    expect(statusbar()).toContain('1 words');
  });

  it('follows a locale changed after the editor was built', async () => {
    await mountEditor();
    expect(findToolbarButton('加粗').exists()).toBe(true);

    await wrapper.setProps({ locale: 'en' });
    await flush();

    expect(findToolbarButton('Bold').exists()).toBe(true);
    expect(statusbar()).toContain('words');
  });

  it('refreshes mounted code-block and column node-view labels at runtime', async () => {
    await mountEditor({
      modelValue:
        '<pre><code>x</code></pre><div class="ue-columns"><div class="ue-column"><p>a</p></div></div>'
    });
    const codeLanguage = () =>
      editor.view.dom.querySelector<HTMLButtonElement>('.ue-codeblock__lang')?.title;
    const addColumn = () =>
      editor.view.dom.querySelector<HTMLButtonElement>('.ue-columns__btn')?.title;
    expect(codeLanguage()).toBe('代码语言');
    expect(addColumn()).toBe('加一栏');

    await wrapper.setProps({
      locale: 'en',
      messages: { 'codeBlock.language': 'Syntax', 'columns.add': 'Add card' }
    });
    await nextTick();

    expect(codeLanguage()).toBe('Syntax');
    expect(addColumn()).toBe('Add card');
  });

  it('lets a host override a single string without forking a locale', async () => {
    await mountEditor({ messages: { 'toolbar.bold': '粗体' } });

    expect(findToolbarButton('粗体').exists()).toBe(true);
  });
});

describe('link', () => {
  const promptInput = () => document.body.querySelector<HTMLInputElement>('.ue-dialog .ue-input');

  async function typeLink(value: string) {
    promptInput()!.value = value;
    promptInput()!.dispatchEvent(new Event('input'));
    await nextTick();
  }

  it('links the selection with the URL the author types', async () => {
    await mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 3 });

    await toolbarButton('链接').trigger('click');
    await nextTick();
    await typeLink('https://example.com');
    dialogButton('确定')?.click();
    await flush();

    expect(editor.getHTML()).toContain('href="https://example.com"');
  });

  it('refuses an unsafe URL and keeps the dialog open to fix it', async () => {
    await mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 3 });

    await toolbarButton('链接').trigger('click');
    await nextTick();
    await typeLink('javascript:alert(1)');
    dialogButton('确定')?.click();
    await nextTick();

    expect(document.body.querySelector('.ue-field__error')?.textContent).toBe('不支持的链接地址');
    expect(document.body.querySelector('.ue-dialog')).not.toBeNull();
    expect(editor.getHTML()).not.toContain('javascript:');
  });

  it('unlinks when the author clears the URL', async () => {
    await mountEditor({ modelValue: '<p><a href="https://example.com">站点</a></p>' });
    editor.commands.setTextSelection({ from: 1, to: 3 });

    await toolbarButton('链接').trigger('click');
    await nextTick();
    expect(promptInput()?.value).toBe('https://example.com');

    await typeLink('');
    dialogButton('确定')?.click();
    await flush();

    expect(editor.getHTML()).toBe('<p>站点</p>');
  });

  it('changes nothing when the dialog is cancelled', async () => {
    await mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 3 });

    await toolbarButton('链接').trigger('click');
    await nextTick();
    await typeLink('https://example.com');
    dialogButton('取消')?.click();
    await flush();

    expect(editor.getHTML()).toBe('<p>正文</p>');
  });
});

describe('text colour', () => {
  it('paints the selection in the picked colour and takes it off again', async () => {
    await mountEditor();
    editor.commands.setTextSelection({ from: 1, to: 3 });

    await wrapper.get('.ue-color-trigger').trigger('click');
    document.body.querySelector<HTMLButtonElement>('.ue-swatch[aria-label="#dc2626"]')?.click();
    await flush();

    expect(editor.getHTML()).toContain('color: rgb(220, 38, 38)');
    expect(wrapper.get('.ue-color-trigger__chip').attributes('style')).toContain(
      'rgb(220, 38, 38)'
    );

    await wrapper.get('.ue-color-trigger').trigger('click');
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-color-actions .ue-btn'))
      .find((entry) => entry.textContent?.trim() === '清除底色')
      ?.click();
    await flush();

    expect(editor.getHTML()).toBe('<p>正文</p>');
  });
});

describe('the upload seam', () => {
  const file = (name = 'a.png', type = 'image/png', bytes = 'x') =>
    new File([bytes], name, { type });

  async function pick(files: File[]) {
    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: files, configurable: true });
    await input.trigger('change');
    await flushPromises();
  }

  it('opens the file picker from the toolbar', async () => {
    await mountEditor();
    const input = wrapper.find('input[type="file"]').element as HTMLInputElement;
    const open = vi.spyOn(input, 'click').mockImplementation(() => {});

    await toolbarButton('图片（插入后右击可旋转 / 裁切 / 对齐 / 加图注）').trigger('click');

    expect(open).toHaveBeenCalled();
  });

  it('sends the picked file to the host handler and inserts the URL it returns', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/a.png');
    await mountEditor({ upload });

    await pick([file()]);

    expect(upload).toHaveBeenCalledWith(expect.any(File), 'a.png');
    expect(editor.getHTML()).toContain('src="https://cdn.example.com/a.png"');
  });

  it('uploads nothing when the picker is dismissed without a file', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/a.png');
    await mountEditor({ upload });

    await pick([]);

    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads nothing when the picker hands back no file list at all', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/a.png');
    await mountEditor({ upload });

    const input = wrapper.find('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: null, configurable: true });
    await input.trigger('change');
    await flushPromises();

    expect(upload).not.toHaveBeenCalled();
  });

  it('reports a file too large as an error and a toast, and inserts nothing', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/a.png');
    await mountEditor({ upload, maxImageSize: 4 });

    await pick([file('big.png', 'image/png', '一张很大的图片')]);

    const [[error]] = wrapper.emitted('upload-error') as [[UploadError]];
    expect(error.code).toBe('too-large');
    expect(toasts()).toEqual([`图片大小 ${error.size} 超过限制，最大支持 0.00MB`]);
    expect(upload).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe('<p>正文</p>');
  });

  it('uses a max image size changed after mount', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/a.png');
    await mountEditor({ upload, maxImageSize: 1024 });

    await wrapper.setProps({ maxImageSize: 1 });
    await pick([file('now-too-big.png', 'image/png', 'large')]);

    expect(upload).not.toHaveBeenCalled();
    expect((wrapper.emitted('upload-error') as [[UploadError]])[0][0].code).toBe('too-large');
  });

  it('reports an unsupported file as an error and a toast', async () => {
    await mountEditor();

    await pick([file('notes.txt', 'text/plain')]);

    const [[error]] = wrapper.emitted('upload-error') as [[UploadError]];
    expect(error.code).toBe('unsupported');
    expect(toasts()).toEqual(['不支持的文件类型']);
  });

  it('reports a failing upload handler as an error and a toast', async () => {
    const upload = vi.fn(async () => {
      throw new Error('502');
    });
    await mountEditor({ upload });

    await pick([file()]);

    const [[error]] = wrapper.emitted('upload-error') as [[UploadError]];
    expect(error.code).toBe('failed');
    expect(toasts()).toEqual(['图片上传失败，请稍后重试']);
    expect(editor.getHTML()).toBe('<p>正文</p>');
  });

  it('honours an upload handler swapped in after the editor was built', async () => {
    const first = vi.fn(async () => 'https://cdn.example.com/first.png');
    const second = vi.fn(async () => 'https://cdn.example.com/second.png');
    await mountEditor({ upload: first });

    await wrapper.setProps({ upload: second });
    await pick([file()]);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(editor.getHTML()).toContain('second.png');
  });
});

describe('the image context menu', () => {
  const imageInDom = () => editor.view.dom.querySelector('img') as HTMLElement;

  it('opens on a right-click over an image and selects it', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));

    rightClick(imageInDom());
    await nextTick();

    expect(document.body.querySelector('.ue-menu')).not.toBeNull();
    expect(menuItem('裁切')).toBeDefined();
    expect(editor.state.selection.from).toBe(posOf('image'));
  });

  it('finds the image through the DOM when the pointer misses the node', async () => {
    await mountEditor({ modelValue: IMAGE });
    // posAtCoords lands outside any node — the <img> under the pointer still wins.
    pointAt(null);

    rightClick(imageInDom());
    await nextTick();

    expect(menuItem('裁切')).toBeDefined();
  });

  it('leaves the browser’s own menu alone away from images and tables', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(1, 0);

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    editor.view.dom.querySelector('p')?.dispatchEvent(event);
    await nextTick();

    expect(document.body.querySelector('.ue-menu')).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves the browser menu alone and opens no image actions in read-only mode', async () => {
    await mountEditor({ modelValue: IMAGE, editable: false });
    pointAt(posOf('image'));
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    imageInDom().dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(false);
    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it('finds the image when the DOM maps to the position just after it', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(null);
    // posAtDOM answers with the position *after* the image for some DOM shapes.
    vi.spyOn(editor.view, 'posAtDOM').mockReturnValue(posOf('image') + 1);

    rightClick(imageInDom());
    await nextTick();

    expect(menuItem('裁切')).toBeDefined();
  });

  it('opens no menu when the DOM shape defeats position lookup', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(null);
    vi.spyOn(editor.view, 'posAtDOM').mockImplementation(() => {
      throw new Error('unmappable DOM shape');
    });

    rightClick(imageInDom());
    await nextTick();

    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it('aligns the image and closes the menu', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();

    menuItem('居中')?.click();
    await flush();

    expect(editor.getHTML()).toContain('data-align="center"');
    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it('captions the image with the text the author types', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();

    menuItem('添加图注')?.click();
    await nextTick();

    const input = document.body.querySelector<HTMLInputElement>('.ue-dialog .ue-input')!;
    input.value = '一张配图';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    dialogButton('确定')?.click();
    await flush();

    expect(editor.getHTML()).toContain('<figcaption>一张配图</figcaption>');
  });

  it('drops the caption when the author clears it', async () => {
    await mountEditor({
      modelValue:
        '<figure class="ue-figure"><img src="/a.png"><figcaption>旧图注</figcaption></figure>'
    });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();

    menuItem('编辑图注')?.click();
    await nextTick();

    const input = document.body.querySelector<HTMLInputElement>('.ue-dialog .ue-input')!;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    dialogButton('确定')?.click();
    await flush();

    expect(editor.getHTML()).not.toContain('<figcaption>');
  });

  it('changes nothing when the caption dialog is cancelled', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();
    const before = editor.getHTML();

    menuItem('添加图注')?.click();
    await nextTick();
    dialogButton('取消')?.click();
    await flush();

    expect(editor.getHTML()).toBe(before);
  });

  it('captions nothing when the document moved on under the open menu', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();

    editor.commands.setTextSelection(1);
    menuItem('添加图注')?.click();
    await nextTick();

    expect(document.body.querySelector('.ue-dialog .ue-input')).toBeNull();
  });

  it('acts on nothing when the document moved on under the open menu', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();
    const before = editor.getHTML();

    // The menu is open, but the caret has moved off the image since.
    editor.commands.setTextSelection(1);
    menuItem('居中')?.click();
    await flush();

    expect(editor.getHTML()).toBe(before);
  });

  it('does not run an image action after the host switches the open editor to read-only', async () => {
    await mountEditor({ modelValue: IMAGE });
    pointAt(posOf('image'));
    rightClick(imageInDom());
    await nextTick();
    const align = menuItem('居中')!;

    await wrapper.setProps({ editable: false });
    align.click();
    await flush();

    expect(editor.getHTML()).not.toContain('data-align');
  });
});

describe('rotating and cropping an image', () => {
  const ctx = { translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), drawImage: vi.fn() };

  class FakeImage {
    crossOrigin = '';
    naturalWidth = 800;
    naturalHeight = 600;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    #src = '';
    get src() {
      return this.#src;
    }
    set src(value: string) {
      this.#src = value;
      queueMicrotask(() => this.onload?.());
    }
  }

  let exported: Blob | null;

  beforeEach(() => {
    // jsdom has no canvas and decodes no images; the real `transformImage` from
    // core runs on top of these.
    exported = new Blob(['png'], { type: 'image/png' });
    vi.stubGlobal('Image', FakeImage);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      ctx as unknown as CanvasRenderingContext2D
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(exported);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openImageMenu(props: Partial<UltraEditorProps> = {}) {
    await mountEditor({ modelValue: IMAGE, ...props });
    pointAt(posOf('image'));
    rightClick(editor.view.dom.querySelector('img') as HTMLElement);
    await nextTick();
  }

  const imageSources = () => {
    const sources: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') sources.push(node.attrs.src as string);
    });
    return sources;
  };

  async function cropperImage() {
    await vi.waitFor(() =>
      expect(document.body.querySelector<HTMLImageElement>('.ue-crop__img')).not.toBeNull()
    );
    return document.body.querySelector<HTMLImageElement>('.ue-crop__img')!;
  }

  it('rotates through the host’s fetcher and upload handler, and swaps the src', async () => {
    const fetchImage = vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
    const upload = vi.fn(async () => 'https://cdn.example.com/rotated.png');
    await openImageMenu({ fetchImage, upload });

    menuItem('顺时针旋转 90°')?.click();
    await flushPromises();
    await flush();

    expect(fetchImage).toHaveBeenCalledWith('/a.png');
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(upload).toHaveBeenCalledWith(expect.any(Blob), 'rotate.png');
    expect(editor.getHTML()).toContain('src="https://cdn.example.com/rotated.png"');
    expect(toasts()).toEqual(['已旋转']);
  });

  it('runs one rotation at a time, however fast the menu is clicked', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/rotated.png');
    await openImageMenu({ upload, fetchImage: async () => new Blob(['jpeg']) });

    // Both clicks land before Vue takes the menu down.
    const rotate = menuItem('顺时针旋转 90°')!;
    rotate.click();
    rotate.click();
    await flushPromises();
    await flush();

    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('applies a delayed rotation to the image that started it, not the current selection', async () => {
    const pending = deferred<string>();
    const upload = vi.fn(() => pending.promise);
    await mountEditor({
      modelValue: '<img src="/first.png"><img src="/second.png">',
      upload,
      fetchImage: async () => new Blob(['jpeg'])
    });
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') positions.push(pos);
    });
    pointAt(positions[0]);
    rightClick(editor.view.dom.querySelector('img')!);
    await nextTick();

    menuItem('顺时针旋转 90°')?.click();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    editor.commands.insertContentAt(0, '<p>前置</p>');
    const movedPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') movedPositions.push(pos);
    });
    editor.commands.setNodeSelection(movedPositions[1]);
    pending.resolve('https://cdn.example.com/rotated-first.png');
    await flushPromises();
    await flush();

    expect(imageSources()).toEqual(['https://cdn.example.com/rotated-first.png', '/second.png']);
  });

  it('drops a delayed rotation when its original image was deleted', async () => {
    const pending = deferred<string>();
    const upload = vi.fn(() => pending.promise);
    await mountEditor({
      modelValue: '<img src="/first.png"><img src="/second.png">',
      upload,
      fetchImage: async () => new Blob(['jpeg'])
    });
    const first = posOf('image');
    pointAt(first);
    rightClick(editor.view.dom.querySelector('img')!);
    await nextTick();

    menuItem('顺时针旋转 90°')?.click();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    editor.commands.deleteRange({ from: first, to: first + 1 });
    pending.resolve('https://cdn.example.com/orphaned.png');
    await flushPromises();
    await flush();

    expect(imageSources()).toEqual(['/second.png']);
    expect(toasts()).not.toContain('已旋转');
  });

  it('honours an image fetcher swapped in after the editor was built', async () => {
    const first = vi.fn(async () => new Blob(['first'], { type: 'image/jpeg' }));
    const second = vi.fn(async () => new Blob(['second'], { type: 'image/jpeg' }));
    const upload = vi.fn(async () => 'https://cdn.example.com/rotated.png');
    await openImageMenu({ upload, fetchImage: first });

    await wrapper.setProps({ fetchImage: second });
    menuItem('顺时针旋转 90°')?.click();
    await flushPromises();
    await flush();

    // The re-encode reads the fetcher through the computed, never a copy frozen at
    // construction — that is what makes a handler swapped in after mount take effect.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('/a.png');
    expect(editor.getHTML()).toContain('src="https://cdn.example.com/rotated.png"');
  });

  it('reports a failed rotation rather than corrupting the image', async () => {
    const upload = vi.fn(async () => {
      throw new Error('502');
    });
    await openImageMenu({ upload, fetchImage: async () => new Blob(['jpeg']) });

    menuItem('逆时针旋转 90°')?.click();
    await flushPromises();
    await flush();

    expect(editor.getHTML()).toContain('src="/a.png"');
    expect(toasts()).toEqual(['图片旋转失败，请重试']);
  });

  it('refuses to upload a rotation that came back over the size limit', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/rotated.png');
    await openImageMenu({ upload, maxImageSize: 1, fetchImage: async () => new Blob(['jpeg']) });

    menuItem('顺时针旋转 90°')?.click();
    await flushPromises();
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['图片旋转失败，请重试']);
  });

  it('crops through the cropper and swaps in the uploaded result', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/cropped.png');
    await openImageMenu({ upload, fetchImage: async () => new Blob(['jpeg']) });

    menuItem('裁切')?.click();
    await flushPromises();

    wrapper.findComponent({ name: 'UeCropper' }).vm.$emit('update:modelValue', true);
    await nextTick();

    const img = await cropperImage();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new Event('load'));
    await nextTick();

    dialogButton('确定')?.click();
    await flushPromises();
    await flush();

    expect(upload).toHaveBeenCalledWith(expect.any(Blob), 'crop.png');
    expect(editor.getHTML()).toContain('src="https://cdn.example.com/cropped.png"');
    expect(document.body.querySelector('.ue-crop__stage')).toBeNull();
  });

  it('applies a delayed crop to the image that opened the cropper', async () => {
    const pending = deferred<string>();
    const upload = vi.fn(() => pending.promise);
    await mountEditor({
      modelValue: '<img src="/first.png"><img src="/second.png">',
      upload,
      fetchImage: async () => new Blob(['jpeg'])
    });
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'image') positions.push(pos);
    });
    pointAt(positions[0]);
    rightClick(editor.view.dom.querySelector('img')!);
    await nextTick();
    menuItem('裁切')?.click();
    await flushPromises();

    const img = await cropperImage();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new Event('load'));
    await nextTick();
    dialogButton('确定')?.click();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    editor.commands.setNodeSelection(positions[1]);
    pending.resolve('https://cdn.example.com/cropped-first.png');
    await flushPromises();
    await flush();

    expect(imageSources()).toEqual(['https://cdn.example.com/cropped-first.png', '/second.png']);
  });

  it('reports a failed upload of a crop', async () => {
    const upload = vi.fn(async () => {
      throw new Error('502');
    });
    await openImageMenu({ upload, fetchImage: async () => new Blob(['jpeg']) });

    menuItem('裁切')?.click();
    await flushPromises();

    const img = await cropperImage();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new Event('load'));
    await nextTick();

    dialogButton('确定')?.click();
    await flushPromises();
    await flush();

    expect(editor.getHTML()).toContain('src="/a.png"');
    expect(toasts()).toEqual(['图片上传失败，请稍后重试']);
  });

  it('refuses to upload a crop that came back over the size limit', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/cropped.png');
    await openImageMenu({ upload, maxImageSize: 1, fetchImage: async () => new Blob(['jpeg']) });

    menuItem('裁切')?.click();
    await flushPromises();

    const img = await cropperImage();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new Event('load'));
    await nextTick();

    dialogButton('确定')?.click();
    await flushPromises();
    await flush();

    expect(upload).not.toHaveBeenCalled();
    expect(toasts()).toEqual(['图片上传失败，请稍后重试']);
  });

  it('surfaces an export failure from the cropper as a toast', async () => {
    await openImageMenu({ fetchImage: async () => new Blob(['jpeg']) });

    menuItem('裁切')?.click();
    await flushPromises();

    const img = await cropperImage();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img.dispatchEvent(new Event('load'));
    await nextTick();

    exported = null;
    dialogButton('确定')?.click();
    await flushPromises();
    await flush();

    expect(toasts()).toEqual(['图片导出失败，请重试']);
  });

  it('opens no cropper when the selection is not an image', async () => {
    await openImageMenu();

    editor.commands.setTextSelection(1);
    menuItem('裁切')?.click();
    await nextTick();

    expect(document.body.querySelector('.ue-crop__stage')).toBeNull();
  });

  it('rotates nothing when the selection is not an image', async () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/rotated.png');
    await openImageMenu({ upload });

    editor.commands.setTextSelection(1);
    menuItem('顺时针旋转 90°')?.click();
    await flushPromises();

    expect(upload).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});

describe('the table context menu', () => {
  async function openTableMenu(cell = 0) {
    await mountEditor({ modelValue: TABLE });
    const cells = cellPositions();
    pointAt(cells[cell] + 2);
    rightClick(editor.view.dom.querySelector('td, th') as HTMLElement);
    await nextTick();
  }

  const rows = () => editor.getHTML().match(/<tr>/g)?.length ?? 0;
  const cols = () => editor.state.doc.child(0).child(0).childCount;

  it('opens inside a table and nowhere else', async () => {
    await mountEditor({ modelValue: `<p>正文</p>${TABLE}` });

    pointAt(1);
    rightClick(editor.view.dom.querySelector('p') as HTMLElement);
    await nextTick();
    expect(document.body.querySelector('.ue-menu')).toBeNull();

    pointAt(cellPositions()[0] + 2);
    rightClick(editor.view.dom.querySelector('th') as HTMLElement);
    await nextTick();
    expect(menuItem('删除表格')).toBeDefined();
  });

  it('leaves the browser menu alone and opens no table actions in read-only mode', async () => {
    await mountEditor({ modelValue: TABLE, editable: false });
    pointAt(cellPositions()[0] + 2);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    editor.view.dom.querySelector('th')?.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(false);
    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it('opens no menu when the pointer maps to no position at all', async () => {
    await mountEditor({ modelValue: TABLE });
    pointAt(null);

    rightClick(editor.view.dom.querySelector('th') as HTMLElement);
    await nextTick();

    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it('closes when the author clicks away from it', async () => {
    await openTableMenu();
    await new Promise((resolve) => requestAnimationFrame(resolve));

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it.each([
    { label: '上方插入行', expected: 3 },
    { label: '下方插入行', expected: 3 },
    { label: '删除本行', expected: 1 }
  ])('$label changes the row count to $expected', async ({ label, expected }) => {
    await openTableMenu();

    menuItem(label)?.click();
    await flush();

    expect(rows()).toBe(expected);
  });

  it.each([
    { label: '左侧插入列', expected: 3 },
    { label: '右侧插入列', expected: 3 },
    { label: '删除本列', expected: 1 }
  ])('$label changes the column count to $expected', async ({ label, expected }) => {
    await openTableMenu();

    menuItem(label)?.click();
    await flush();

    expect(cols()).toBe(expected);
  });

  it('deletes the whole table', async () => {
    await openTableMenu();

    menuItem('删除表格')?.click();
    await flush();

    expect(editor.getHTML()).not.toContain('<table>');
  });

  it('does not run a table action after the host switches the open editor to read-only', async () => {
    await openTableMenu();
    const remove = menuItem('删除表格')!;

    await wrapper.setProps({ editable: false });
    remove.click();
    await flush();

    expect(editor.getHTML()).toContain('<table');
  });

  it('toggles the header row off', async () => {
    await openTableMenu();
    expect(editor.getHTML()).toContain('<th');

    menuItem('切换标题行')?.click();
    await flush();

    expect(editor.getHTML()).not.toContain('<th');
  });

  it('toggles the header column on', async () => {
    await openTableMenu();

    menuItem('切换标题列')?.click();
    await flush();

    // The first cell of the body row becomes a header too.
    expect(editor.getHTML().match(/<th/g)?.length).toBe(3);
  });

  it('offers merge only for a multi-cell selection, and merges it', async () => {
    await openTableMenu();
    expect(menuItem('合并单元格')?.disabled).toBe(true);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();

    const cells = cellPositions();
    editor.commands.setCellSelection({ anchorCell: cells[0], headCell: cells[1] });
    pointAt(cells[0] + 2);
    rightClick(editor.view.dom.querySelector('th') as HTMLElement);
    await nextTick();

    expect(menuItem('合并单元格')?.disabled).toBe(false);
    menuItem('合并单元格')?.click();
    await flush();

    expect(editor.getHTML()).toContain('colspan="2"');
  });

  it('offers split only for a merged cell, and splits it', async () => {
    await mountEditor({
      modelValue:
        '<table><tbody><tr><th colspan="2"><p>甲</p></th></tr><tr><td><p>丙</p></td><td><p>丁</p></td></tr></tbody></table>'
    });
    pointAt(cellPositions()[0] + 2);
    rightClick(editor.view.dom.querySelector('th') as HTMLElement);
    await nextTick();

    expect(menuItem('拆分单元格')?.disabled).toBe(false);
    menuItem('拆分单元格')?.click();
    await flush();

    expect(editor.getHTML()).not.toContain('colspan="2"');
  });

  it('paints a cell background and clears it again', async () => {
    await openTableMenu();

    const row = menuItem('单元格底色')!;
    row.click();
    await nextTick();
    document.body.querySelector<HTMLButtonElement>('.ue-swatch[aria-label="#facc15"]')?.click();
    await flush();

    expect(editor.getHTML()).toContain('background-color: rgb(250, 204, 21)');

    pointAt(cellPositions()[0] + 2);
    rightClick(editor.view.dom.querySelector('th') as HTMLElement);
    await nextTick();
    menuItem('单元格底色')!.click();
    await nextTick();
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-color-actions .ue-btn'))
      .find((entry) => entry.textContent?.trim() === '清除底色')
      ?.click();
    await flush();

    expect(editor.getHTML()).not.toContain('background-color');
  });

  it('does not paint or clear a cell after the host switches to read-only', async () => {
    await openTableMenu();
    menuItem('单元格底色')!.click();
    await nextTick();
    const paint = document.body.querySelector<HTMLButtonElement>(
      '.ue-swatch[aria-label="#facc15"]'
    )!;
    const clear = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.ue-color-actions .ue-btn')
    ).find((entry) => entry.textContent?.trim() === '清除底色')!;

    await wrapper.setProps({ editable: false });
    paint.click();
    clear.click();
    await flush();

    expect(editor.getHTML()).not.toContain('background-color');
  });

  it('shows the colour the cell already carries', async () => {
    await mountEditor({
      modelValue:
        '<table><tbody><tr><td style="background-color: #facc15"><p>甲</p></td></tr></tbody></table>'
    });
    pointAt(cellPositions()[0] + 2);
    rightClick(editor.view.dom.querySelector('td') as HTMLElement);
    await nextTick();

    const chip = document.body.querySelector<HTMLElement>('.ue-menu__chip');
    expect(chip?.classList.contains('ue-menu__chip--none')).toBe(false);
  });
});

describe('the slash palette', () => {
  const slashMenu = () => document.body.querySelector('.ue-slash');
  const slashItems = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-slash .ue-menu__item'));
  const groups = () =>
    Array.from(document.body.querySelectorAll('.ue-slash .ue-menu__group')).map((group) =>
      group.textContent?.trim()
    );
  const highlighted = () =>
    document.body.querySelector('.ue-slash .ue-menu__item.is-highlighted')?.textContent?.trim();

  const key = (name: string) =>
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    );

  /**
   * Tiptap's suggestion plugin resolves its item list asynchronously: `onStart`
   * fires with an empty list and `onUpdate` delivers the items a microtask later.
   * A bare `nextTick` lands between the two and sees an empty palette.
   */
  async function settle() {
    await flushPromises();
    await nextTick();
  }

  async function openPalette(props: Partial<UltraEditorProps> = {}) {
    await mountEditor({ modelValue: '<p></p>', ...props });
    editor.commands.focus();
    editor.commands.insertContent('/');
    await settle();
  }

  it('opens on a slash and lists the commands in group order', async () => {
    await openPalette({ ai: { provider: provider(['x']) } });

    expect(slashMenu()).not.toBeNull();
    expect(groups()).toEqual(['基础', '插入', 'AI']);
    expect(highlighted()).toBe('标题 1');
  });

  it('hides the AI commands when no provider is configured', async () => {
    await openPalette();

    expect(groups()).toEqual(['基础', '插入']);
    expect(slashItems().map((item) => item.textContent?.trim())).not.toContain('AI 写一段');
  });

  it('runs the picked command and takes the typed slash back out of the document', async () => {
    await openPalette();

    slashItems()
      .find((item) => item.textContent?.trim() === '标题 2')!
      .click();
    await settle();

    expect(editor.getHTML()).toContain('<h2></h2>');
    // The typed `/` has to go with it, or the author is left with it in their prose.
    expect(editor.getText()).not.toContain('/');
    expect(slashMenu()).toBeNull();
  });

  it('routes an AI command from the palette to the panel instead of the document', async () => {
    await openPalette({ ai: { provider: provider(['生成的内容']) } });

    slashItems()
      .find((item) => item.textContent?.trim() === 'AI 写一段')!
      .click();
    await settle();

    // `write` needs a brief, so the palette hands over to the prompt rather than
    // writing anything itself.
    expect(document.body.querySelector('.ue-ai-panel')).not.toBeNull();
    expect(editor.getHTML()).toBe('<p></p>');
  });

  it('still opens when its anchor cannot be measured', async () => {
    await mountEditor({ modelValue: '<p></p>' });
    editor.commands.focus();

    // Tiptap anchors the palette to the suggestion's decoration span: it looks the
    // node up once to pick a measuring strategy, then looks it up again to measure,
    // and hands back null if it has gone in between. Without the guard in placeSlash
    // that null reaches `Math.min(rect.left, …)` and the keystroke that opened the
    // palette throws.
    vi.spyOn(editor.view.dom, 'querySelector')
      .mockReturnValueOnce(document.createElement('span'))
      .mockReturnValue(null);

    editor.commands.insertContent('/');
    await settle();

    expect(slashMenu()).not.toBeNull();
    expect(slashItems().map((item) => item.textContent?.trim())).toContain('标题 1');
  });

  it('filters as the author keeps typing, and says when nothing matches', async () => {
    await openPalette();

    editor.commands.insertContent('table');
    await settle();
    expect(slashItems().map((item) => item.textContent?.trim())).toEqual(['表格']);

    editor.commands.insertContent('zzz');
    await settle();
    expect(document.body.querySelector('.ue-menu__empty')?.textContent).toBe('没有匹配的命令');
  });

  it('runs the highlighted command on Enter', async () => {
    await openPalette();

    key('ArrowDown');
    await nextTick();
    expect(highlighted()).toBe('标题 2');

    key('Enter');
    await flush();

    expect(editor.getHTML()).toContain('<h2>');
    expect(slashMenu()).toBeNull();
  });

  it('wraps the highlight around both ends of the list', async () => {
    await openPalette();

    key('ArrowUp');
    await nextTick();
    expect(highlighted()).toBe('分割线');

    key('ArrowDown');
    await nextTick();
    expect(highlighted()).toBe('标题 1');
  });

  it('closes on Escape without running anything', async () => {
    await openPalette();

    key('Escape');
    await nextTick();

    expect(slashMenu()).toBeNull();
    expect(editor.getHTML()).toBe('<p>/</p>');
  });

  it('runs nothing on Enter while it has nothing to offer', async () => {
    await openPalette();

    editor.commands.insertContent('zzz');
    await settle();
    expect(document.body.querySelector('.ue-menu__empty')).not.toBeNull();

    key('ArrowDown');
    key('Enter');
    await settle();

    // Enter fell through to the editor, which split the block — no command ran.
    expect(editor.getHTML()).toBe('<p>/zzz</p><p></p>');
  });

  it('hands the keyboard back to the editor once it has been dismissed', async () => {
    await openPalette();
    key('Escape');
    await nextTick();
    expect(slashMenu()).toBeNull();

    key('Enter');
    await settle();

    // The suggestion is still live in the document, but a dismissed palette must
    // not act on the keystroke.
    expect(editor.getHTML()).toBe('<p>/</p><p></p>');
  });

  it('leaves other keys to the editor', async () => {
    await openPalette();

    key('a');
    await nextTick();

    expect(slashMenu()).not.toBeNull();
  });

  it('runs the command the author clicks', async () => {
    await openPalette();

    slashItems()
      .find((item) => item.textContent?.trim() === '表格')
      ?.click();
    await flush();

    expect(editor.getHTML().match(/<tr>/g)).toHaveLength(3);
    expect(slashMenu()).toBeNull();
  });

  it('moves the highlight to whatever the pointer is over', async () => {
    await openPalette();

    slashItems()[2].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await nextTick();

    expect(highlighted()).toBe('标题 3');
  });

  it('stays out of the way entirely when the host disables it', async () => {
    await openPalette({ ai: { provider: provider(['x']), slash: false } });

    expect(slashMenu()).toBeNull();
    expect(editor.getHTML()).toBe('<p>/</p>');
  });

  it('can be enabled with a new item list after the editor was built', async () => {
    await openPalette({ ai: { slash: false } });
    expect(slashMenu()).toBeNull();

    const table = DEFAULT_SLASH_ITEMS.find((item) => item.key === 'table')!;
    await wrapper.setProps({ ai: { slash: true, slashItems: [table] } });
    editor.commands.setContent('<p></p>');
    editor.commands.focus();
    editor.commands.insertContent('/');
    await settle();

    expect(slashItems().map((item) => item.textContent?.trim())).toEqual(['表格']);
  });
});

describe('AI', () => {
  const aiPanel = () => document.body.querySelector('.ue-ai-panel');

  it('hides every AI surface when no provider is configured', async () => {
    await mountEditor();

    expect(wrapper.find('.ue-tb-btn--ai').exists()).toBe(false);
  });

  it('shows the AI surfaces as soon as a provider turns up', async () => {
    await mountEditor();
    expect(wrapper.find('.ue-tb-btn--ai').exists()).toBe(false);

    await wrapper.setProps({ ai: { provider: provider(['x']) } });

    expect(wrapper.find('.ue-tb-btn--ai').exists()).toBe(true);
  });

  it('lets ghost text be switched on after the editor was built', async () => {
    await mountEditor({ ai: { provider: provider(['x']) } });
    const ghost = editor.extensionManager.extensions.find((one) => one.name === 'ghostText');
    const enabled = () => (ghost!.options as { enabled: () => boolean }).enabled();

    expect(enabled()).toBe(false);

    await wrapper.setProps({ ai: { provider: provider(['x']), ghostText: true } });

    expect(enabled()).toBe(true);
  });

  it('reads a changed ghost delay without rebuilding the extension', async () => {
    await mountEditor({ ai: { provider: provider(['x']) } });
    const ghost = editor.extensionManager.extensions.find((one) => one.name === 'ghostText');
    const delay = () => (ghost!.options as { delay: () => number }).delay();

    expect(delay()).toBe(800);
    await wrapper.setProps({ ai: { provider: provider(['x']), ghostDelay: 5 } });
    expect(delay()).toBe(5);
  });

  it('completes the sentence with ghost text once the author pauses', async () => {
    await mountEditor({
      modelValue: '<p>这是一段足够长的正文</p>',
      ai: { provider: provider(['，然后继续写下去']), ghostText: true, ghostDelay: 1 }
    });

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    await vi.waitFor(() =>
      expect(editor.view.dom.querySelector('.ue-ghost')?.textContent).toContain('，然后继续写下去')
    );
    // A suggestion nobody accepted is a decoration, never document content.
    expect(editor.getHTML()).toBe('<p>这是一段足够长的正文</p>');
  });

  it('continues the document from the toolbar', async () => {
    await mountEditor({ ai: { provider: provider(['续写的内容']) } });

    await toolbarButton('AI 助手').trigger('click');
    await vi.waitFor(() => expect(editor.getText()).toContain('续写的内容'));

    expect(aiPanel()).not.toBeNull();
  });

  it('collapses an accepted generation into a single undo step', async () => {
    await mountEditor({
      modelValue: '<p>正文</p>',
      ai: { provider: provider(['生', '成', '的']) }
    });
    const before = editor.getHTML();

    api().runAI('continue');
    await vi.waitFor(() => expect(panelButton('接受')).toBeDefined());
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    panelButton('接受')?.click();
    await flush();
    expect(editor.getHTML()).toBe('<p>正文</p><p>生成的</p>');
    expect(wrapper.emitted('update:modelValue')).toEqual([['<p>正文</p><p>生成的</p>']]);

    editor.commands.undo();

    expect(editor.getHTML()).toBe(before);
    expect(aiPanel()).toBeNull();
  });

  it('leaves no trace when a generation is discarded', async () => {
    await mountEditor({ ai: { provider: provider(['生成的内容']) } });
    const before = editor.getHTML();

    api().runAI('continue');
    await vi.waitFor(() => expect(panelButton('丢弃')).toBeDefined());
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    panelButton('丢弃')?.click();
    await flush();

    expect(editor.getHTML()).toBe(before);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(aiPanel()).toBeNull();
    expect(editor.isEditable).toBe(true);
  });

  it('keeps the partial text when the author stops mid-stream, and raises no error', async () => {
    const stream = paced(['第一段。', '第二段。']);
    await mountEditor({ ai: { provider: stream.provider } });

    api().runAI('continue');
    await stream.next();
    expect(editor.getText()).toContain('第一段。');

    panelButton('停止')?.click();
    await vi.waitFor(() => expect(panelButton('接受')).toBeDefined());

    expect(document.body.querySelector('.ue-ai-panel__error')).toBeNull();
    expect(editor.getText()).toContain('第一段。');
    expect(editor.getText()).not.toContain('第二段。');
  });

  it('writes a new paragraph from a slash-command brief, and undoes as one step', async () => {
    await mountEditor({
      modelValue: '<p>正文</p><p></p>',
      ai: { provider: provider(['AI 段落']) }
    });
    const before = editor.getHTML();

    editor.commands.focus();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent('/');
    // The palette resolves its items asynchronously; a bare nextTick sees it empty.
    await flushPromises();
    await nextTick();

    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-slash .ue-menu__item'))
      .find((item) => item.textContent?.trim() === 'AI 写一段')
      ?.click();
    await nextTick();

    const input = document.body.querySelector<HTMLInputElement>('.ue-ai-panel .ue-input')!;
    input.value = '写一段介绍';
    input.dispatchEvent(new Event('input'));
    await nextTick();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    await vi.waitFor(() => expect(panelButton('接受')).toBeDefined());
    panelButton('接受')?.click();
    await flush();

    expect(editor.getHTML()).toBe('<p>正文</p><p>AI 段落</p>');

    // The slash text, the generation and the swallowed empty paragraph: one undo.
    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
  });

  it('transforms the selection through the bubble menu without touching the document', async () => {
    await mountEditor({ ai: { provider: provider(['润色后的正文']) } });

    editor.view.dom.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await nextTick();

    document.body.querySelector<HTMLButtonElement>('.ue-bubble__btn--ai')?.click();
    await nextTick();
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-bubble .ue-menu__item'))
      .find((item) => item.textContent?.trim() === '润色')
      ?.click();

    await vi.waitFor(() => expect(panelButton('替换原文')).toBeDefined());
    expect(editor.getHTML()).toBe('<p>正文</p>');

    panelButton('替换原文')?.click();
    await flush();

    expect(editor.getHTML()).toBe('<p>润色后的正文</p>');
  });

  it('offers the bubble only the tasks the host configured', async () => {
    await mountEditor({ ai: { provider: provider(['x']), tasks: ['translate'] } });

    editor.view.dom.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await nextTick();

    document.body.querySelector<HTMLButtonElement>('.ue-bubble__btn--ai')?.click();
    await nextTick();

    const items = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.ue-bubble .ue-menu__item')
    ).map((item) => item.textContent?.trim());
    expect(items).toEqual(['翻译']);
  });
});
