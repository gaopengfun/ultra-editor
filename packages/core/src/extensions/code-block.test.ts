import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createLowlight, common } from 'lowlight';
import { createUltraKit, type UltraKitOptions } from '../kit';
import { createLeanUltraKit } from '../lean';
import { UltraCodeBlock, loadCommonLanguages, refreshCodeHighlighting } from './code-block';

let editor: Editor;
let writeText: ReturnType<typeof vi.fn>;

function makeEditor(content: string, options: UltraKitOptions = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit(options) });
}

/** jsdom has no Clipboard API at all, and the node view hides the button without one. */
function stubClipboard(impl: () => Promise<void>) {
  writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

const trigger = () => editor.view.dom.querySelector<HTMLButtonElement>('.ue-codeblock__lang')!;
const copy = () => editor.view.dom.querySelector<HTMLButtonElement>('.ue-codeblock__copy')!;
const code = () => editor.view.dom.querySelector<HTMLElement>('.ue-codeblock code')!;
const menu = () => document.querySelector<HTMLElement>('.ue-codeblock__langs');
const options = () =>
  Array.from(menu()?.querySelectorAll<HTMLButtonElement>('.ue-menu__item') ?? []);
const option = (label: string) => options().find((item) => item.textContent === label)!;

function key(target: EventTarget, name: string) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
  stubClipboard(() => Promise.resolve());
  editor = makeEditor('<pre><code class="language-css">a{}</code></pre>');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (!editor.isDestroyed) editor.destroy();
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** PM flushes its DOM observer on a timer; nothing reaches the node view before it does. */
const flushDOM = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('code block chrome', () => {
  it('never reaches the serialised HTML', () => {
    const html = editor.getHTML();

    // The picker and the copy button exist while writing; a published article
    // gets a bare <pre><code>.
    expect(html).not.toContain('ue-codeblock');
    expect(html).not.toContain('<button');
    expect(html).toBe('<pre data-language="css"><code class="language-css">a{}</code></pre>');
  });

  it('draws the picker and the copy button on the block while editing', () => {
    expect(trigger().textContent).toBe('CSS');
    expect(copy().textContent).toBe('复制');
    expect(copy().hidden).toBe(false);
  });

  it('shows plain text as the language of an untagged block', () => {
    editor.commands.setContent('<pre><code>裸代码</code></pre>');
    expect(trigger().textContent).toBe('纯文本');
  });

  it('keeps a key press on the toolbar out of the document', () => {
    editor.commands.setTextSelection(1);
    const before = editor.getHTML();

    key(trigger(), 'Backspace');

    expect(editor.getHTML()).toBe(before);
  });

  it('lets a key press inside the code reach the editor', () => {
    editor.commands.setTextSelection(1);

    // Backspace at the start of a code block lifts it back to a paragraph — proof
    // the node view did not swallow the event along with its own toolbar's.
    key(code(), 'Backspace');

    expect(editor.getHTML()).toContain('<p>a{}</p>');
    expect(editor.getHTML()).not.toContain('<pre>');
  });

  it('treats a selection over the whole block as a selection, not an edit', async () => {
    editor.commands.setContent('<pre><code>abc</code></pre>');
    // jsdom will not focus a contenteditable div on its own.
    editor.view.dom.setAttribute('tabindex', '0');
    editor.view.dom.focus();

    const range = document.createRange();
    range.setStart(code(), 0);
    range.setEnd(code(), 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushDOM();

    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(4);
    expect(editor.getHTML()).toContain('<pre><code>abc</code></pre>');
  });
});

describe('code block outside a browser', () => {
  it('hands ProseMirror no node view when there is no DOM', () => {
    vi.stubGlobal('window', undefined);

    // The SDK is imported in SSR apps; the picker must not reach for `document`.
    const extension = UltraCodeBlock.configure({ lowlight: createLowlight(common) });
    expect(extension.config.addNodeView?.call(extension as never)).toBeNull();
  });
});

describe('code block language picker', () => {
  it('rewrites the code class when a language is picked', () => {
    trigger().click();
    option('Rust').click();

    expect(editor.getHTML()).toContain(
      '<pre data-language="rust"><code class="language-rust">a{}</code></pre>'
    );
    expect(trigger().textContent).toBe('Rust');
    // The menu is teleported to <body>; picking has to take it back down again.
    expect(menu()).toBeNull();
  });

  it('writes the language onto the pre as well as the code', () => {
    // The class on the <code> is the only place upstream records the language, and
    // it is the first thing an HTML sanitiser drops — most allow-lists have no
    // entry for `class`. On the <pre> as a data attribute it survives the trip,
    // and a read-only page can style or label the block from it.
    trigger().click();
    option('Rust').click();

    const pre = document.createElement('div');
    pre.innerHTML = editor.getHTML();
    expect(pre.querySelector('pre')?.getAttribute('data-language')).toBe('rust');
  });

  it('reads the language back off the pre', () => {
    editor.commands.setContent('<pre data-language="rust"><code>fn main() {}</code></pre>');

    expect(trigger().textContent).toBe('Rust');
    expect(editor.getHTML()).toContain('data-language="rust"');
  });

  it('still reads a language written only as a class on the code', () => {
    // Every document saved before `data-language` existed, and everything the
    // Markdown parser produces from a fenced block.
    editor.commands.setContent('<pre><code class="language-rust">fn main() {}</code></pre>');

    expect(trigger().textContent).toBe('Rust');
  });

  it('drops the class entirely when plain text is picked', () => {
    trigger().click();
    option('纯文本').click();

    expect(editor.getHTML()).toContain('<pre><code>a{}</code></pre>');
    expect(editor.getHTML()).not.toContain('language-');
    expect(editor.getHTML()).not.toContain('data-language');
    expect(code().className).toBe('');
  });

  it('ticks the language the block is already in', () => {
    trigger().click();

    expect(option('CSS').getAttribute('aria-selected')).toBe('true');
    expect(option('CSS').querySelector('.ue-menu__check')).not.toBeNull();
    expect(option('Rust').getAttribute('aria-selected')).toBe('false');
    expect(option('Rust').querySelector('.ue-menu__check')).toBeNull();
  });

  it('moves the tick when the language changes', () => {
    trigger().click();
    option('Rust').click();
    trigger().click();

    expect(option('CSS').querySelector('.ue-menu__check')).toBeNull();
    expect(option('Rust').querySelector('.ue-menu__check')).not.toBeNull();
  });

  it('hides the noisy highlight.js variants', () => {
    trigger().click();
    const labels = options().map((item) => item.textContent);

    expect(labels).not.toContain('plaintext');
    expect(labels).not.toContain('php-template');
    expect(labels).toContain('纯文本');
  });

  it('shows a host-registered language under its raw highlight.js id', () => {
    const lowlight = createLowlight(common);
    lowlight.register('nginx', () => ({ name: 'nginx', contains: [] }));
    editor.destroy();
    editor = makeEditor('<pre><code>x</code></pre>', { lowlight });

    trigger().click();
    // No display name is better than a guessed one.
    expect(option('nginx')).toBeDefined();
  });

  it('announces itself as an expanded listbox while open', () => {
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    trigger().click();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(menu()?.getAttribute('role')).toBe('listbox');

    trigger().click();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(menu()).toBeNull();
  });

  it('opens onto the active language rather than the top of the list', () => {
    trigger().click();
    expect(document.activeElement).toBe(option('CSS'));
  });

  it('opens onto the top of the list for a language it does not offer', () => {
    editor.commands.setContent('<pre><code class="language-klingon">x</code></pre>');
    expect(trigger().textContent).toBe('klingon');

    trigger().click();

    expect(document.activeElement).toBe(options()[0]);
    expect(options()[0].textContent).toBe('纯文本');
  });

  it('walks the list with the arrow keys and wraps at both ends', () => {
    editor.commands.setContent('<pre><code>x</code></pre>');
    trigger().click();
    const items = options();
    expect(document.activeElement).toBe(items[0]);

    key(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);

    key(items[1], 'ArrowUp');
    expect(document.activeElement).toBe(items[0]);

    key(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[items.length - 1]);

    key(items[items.length - 1], 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
  });

  it('leaves focus alone for a key it does not own', () => {
    trigger().click();
    const active = document.activeElement;

    key(active!, 'Enter');

    expect(document.activeElement).toBe(active);
    expect(menu()).not.toBeNull();
  });

  it('closes on Escape and hands focus back to the trigger', () => {
    trigger().click();

    key(document.activeElement!, 'Escape');

    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('stays open for a key that is not Escape', () => {
    trigger().click();

    key(window, 'a');

    expect(menu()).not.toBeNull();
  });

  it('closes when the pointer goes down outside it', () => {
    trigger().click();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(menu()).toBeNull();
  });

  it('stays open when the pointer goes down inside it', () => {
    trigger().click();

    option('Rust').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(menu()).not.toBeNull();

    trigger().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(menu()).not.toBeNull();
  });

  it('closes when the page scrolls under it', () => {
    trigger().click();

    // The list is pinned to the viewport, so it would drift away from its block.
    document.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(menu()).toBeNull();

    trigger().click();
    window.dispatchEvent(new Event('resize'));
    expect(menu()).toBeNull();
  });

  it('stays open while the list itself is scrolled', () => {
    trigger().click();

    // A 35-row list scrolls; that must not be mistaken for the page moving — not
    // even for the scroll that brings the active language into view on open.
    menu()!.dispatchEvent(new Event('scroll', { bubbles: true }));

    expect(menu()).not.toBeNull();
  });

  it('flips above the bar when the block sits near the bottom of the window', () => {
    trigger().click();
    expect(menu()!.style.top).toBe('6px');
    trigger().click();

    trigger().getBoundingClientRect = () =>
      ({ top: window.innerHeight - 20, bottom: window.innerHeight, left: 40 }) as DOMRect;
    trigger().click();

    expect(menu()!.style.top).toBe(`${window.innerHeight - 26}px`);
    expect(menu()!.style.left).toBe('40px');
  });

  it('stops being operable in a read-only editor', () => {
    trigger().click();
    expect(menu()).not.toBeNull();

    editor.setEditable(false);

    expect(trigger().disabled).toBe(true);
    expect(menu()).toBeNull();

    editor.setEditable(true);
    expect(trigger().disabled).toBe(false);
  });

  it('ignores a pick once the block is gone', () => {
    trigger().click();
    const rust = option('Rust');
    editor.commands.setContent('<p>没有代码块</p>');

    expect(() => rust.click()).not.toThrow();
    expect(editor.getHTML()).toBe('<p>没有代码块</p>');
  });
});

describe('code block language catalogue', () => {
  /** An editor whose language set can grow after it was built. */
  function makeLeanEditor(content: string, lowlight: ReturnType<typeof createLowlight>) {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return new Editor({ element, content, extensions: createLeanUltraKit({ lowlight }) });
  }

  it('builds no menu until someone opens one', () => {
    // Thirty-eight buttons per block, eagerly, is thirty-eight buttons per block
    // nobody looked at — a long document paid for every one of them.
    expect(document.querySelector('.ue-codeblock__langs')).toBeNull();
    expect(options()).toHaveLength(0);

    trigger().click();

    expect(options().length).toBeGreaterThan(30);
  });

  it('picks up languages registered after the block was drawn', () => {
    const lowlight = createLowlight();
    editor.destroy();
    editor = makeLeanEditor('<pre><code>x</code></pre>', lowlight);

    // This is the state the Vue component mounts in: the grammars are still in
    // flight, so the picker has nothing but plain text to offer.
    trigger().click();
    expect(options().map((item) => item.textContent)).toEqual(['纯文本']);
    trigger().click();

    lowlight.register('rust', common.rust);
    trigger().click();

    expect(option('Rust')).toBeDefined();
  });

  it('rebuilds an open menu when the grammars land under it', () => {
    const lowlight = createLowlight();
    editor.destroy();
    editor = makeLeanEditor('<pre><code>x</code></pre>', lowlight);
    trigger().click();
    expect(options()).toHaveLength(1);

    lowlight.register('rust', common.rust);
    refreshCodeHighlighting(editor);

    // The menu the user is looking at has to grow under them, not wait for a
    // close and a reopen.
    expect(option('Rust')).toBeDefined();
    expect(menu()).not.toBeNull();
  });

  it('registers the common set on demand', async () => {
    const lowlight = createLowlight();

    await loadCommonLanguages(lowlight);

    expect(lowlight.listLanguages()).toEqual(createLowlight(common).listLanguages());
  });
});

describe('refreshCodeHighlighting', () => {
  it('repaints blocks that were drawn before their grammar existed', () => {
    const lowlight = createLowlight();
    editor.destroy();
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      content: '<pre><code class="language-python">x = 1</code></pre>',
      extensions: createLeanUltraKit({ lowlight })
    });
    expect(editor.view.dom.querySelector('.hljs-number')).toBeNull();

    lowlight.register('python', common.python);
    expect(refreshCodeHighlighting(editor)).toBe(true);

    expect(editor.view.dom.querySelector('.hljs-number')).not.toBeNull();
  });

  it('leaves the document and the undo stack alone', () => {
    const before = editor.getHTML();

    refreshCodeHighlighting(editor);

    expect(editor.getHTML()).toBe(before);
    // The repaint is bookkeeping, not an edit: undo must not have it to give back.
    expect(editor.can().undo()).toBe(false);
  });

  it('dispatches nothing for a document without code blocks', () => {
    editor.commands.setContent('<p>没有代码块</p>');
    const spy = vi.spyOn(editor.view, 'dispatch');

    expect(refreshCodeHighlighting(editor)).toBe(false);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('code block copy button', () => {
  it('copies the block text and confirms it, then goes quiet again', async () => {
    vi.useFakeTimers();

    copy().click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeText).toHaveBeenCalledWith('a{}');
    expect(copy().classList.contains('is-copied')).toBe(true);
    expect(copy().textContent).toBe('已复制');

    await vi.advanceTimersByTimeAsync(1500);

    expect(copy().classList.contains('is-copied')).toBe(false);
    expect(copy().textContent).toBe('复制');
  });

  it('restarts the confirmation on a second copy', async () => {
    vi.useFakeTimers();

    copy().click();
    await vi.advanceTimersByTimeAsync(1000);
    copy().click();
    await vi.advanceTimersByTimeAsync(1000);

    // The first click's timer must not clear the second click's confirmation.
    expect(copy().classList.contains('is-copied')).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    expect(copy().classList.contains('is-copied')).toBe(false);
  });

  it('claims nothing when the clipboard refuses', async () => {
    editor.destroy();
    stubClipboard(() => Promise.reject(new Error('denied')));
    editor = makeEditor('<pre><code>a{}</code></pre>');

    copy().click();
    await Promise.resolve();
    await Promise.resolve();

    expect(copy().classList.contains('is-copied')).toBe(false);
    expect(copy().textContent).toBe('复制');
  });

  it('offers no copy button when the platform has no clipboard', () => {
    editor.destroy();
    Reflect.deleteProperty(navigator, 'clipboard');
    editor = makeEditor('<pre><code>a{}</code></pre>');

    // A button that silently does nothing on an insecure origin is worse than none.
    expect(copy().hidden).toBe(true);
  });

  it('keeps the cursor in the block when the button is pressed', () => {
    editor.commands.setTextSelection(2);
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    copy().dispatchEvent(mousedown);

    // Without preventDefault the editor blurs and the cursor leaves the block that
    // the click is about to copy.
    expect(mousedown.defaultPrevented).toBe(true);
  });

  it('ignores a copy click once the block is gone', () => {
    const button = copy();
    editor.commands.setContent('<p>没有代码块</p>');

    expect(() => button.click()).not.toThrow();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('takes the menu down with the block', () => {
    trigger().click();
    expect(menu()).not.toBeNull();

    editor.commands.setContent('<p>没有代码块</p>');

    expect(menu()).toBeNull();
  });
});
