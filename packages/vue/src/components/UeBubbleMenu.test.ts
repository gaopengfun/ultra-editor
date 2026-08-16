import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';
import { createTranslator, createUltraKit, type AITask } from '@ultra-editor/core';
import UeBubbleMenu from './UeBubbleMenu.vue';

/**
 * jsdom ships no layout engine, so `Range` has no `getClientRects` at all —
 * ProseMirror's `coordsAtPos`, which the bubble calls to place itself, throws
 * without these two.
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

const ALL_TASKS: AITask[] = [
  'improve',
  'translate',
  'summarize',
  'rewrite',
  'expand',
  'shorten',
  'fixGrammar',
  'changeTone',
  'custom'
];

let editor: Editor;
let wrapper: VueWrapper;

function mountBubble(props: { tasks?: AITask[]; hasAI?: boolean } = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, content: '<p>正文</p>', extensions: createUltraKit() });

  wrapper = mount(UeBubbleMenu, {
    attachTo: document.body,
    props: {
      editor,
      tasks: props.tasks ?? ALL_TASKS,
      hasAI: props.hasAI ?? false,
      t: createTranslator('zh-CN')
    }
  });
  return wrapper;
}

const bubble = () => document.body.querySelector<HTMLElement>('.ue-bubble');
const bubbleButton = (title: string) =>
  document.body.querySelector<HTMLButtonElement>(`.ue-bubble__btn[title="${title}"]`);

/**
 * A pointer press is mousedown-then-click. The bubble's buttons swallow the
 * mousedown half on purpose — that is what stops the press from collapsing the
 * selection they are about to act on — so a test that only clicks skips it.
 */
function press(element: HTMLElement | null | undefined) {
  element?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element?.click();
}

/**
 * Focus the contenteditable directly: Tiptap's `focus()` command defers the real
 * `view.focus()` into an animation frame, and the bubble only shows itself for a
 * view that already `hasFocus()`.
 */
async function select(from: number, to: number) {
  editor.view.dom.focus();
  editor.commands.setTextSelection({ from, to });
  await nextTick();
}

beforeEach(() => {
  document.body.innerHTML = '';
  mountBubble();
});

afterEach(() => {
  wrapper.unmount();
  editor.destroy();
});

describe('visibility', () => {
  it('stays hidden while the selection is empty', async () => {
    await select(2, 2);
    expect(bubble()).toBeNull();
  });

  it('appears once text is actually selected', async () => {
    await select(1, 3);
    expect(bubble()).not.toBeNull();
  });

  it('disappears when the selection collapses again', async () => {
    await select(1, 3);
    expect(bubble()).not.toBeNull();

    await select(2, 2);
    expect(bubble()).toBeNull();
  });

  it('disappears when the editor loses focus', async () => {
    await select(1, 3);

    editor.view.dom.blur();
    await nextTick();

    expect(bubble()).toBeNull();
  });

  it('stays away in a read-only editor, where none of its actions apply', async () => {
    editor.setEditable(false);
    await select(1, 3);

    expect(bubble()).toBeNull();
  });

  it('centres itself above the selection', async () => {
    // jsdom has no layout, so the real coordinates have to be supplied.
    vi.spyOn(editor.view, 'coordsAtPos').mockImplementation((pos) =>
      pos === 1
        ? { left: 200, right: 210, top: 100, bottom: 120 }
        : { left: 300, right: 310, top: 100, bottom: 120 }
    );

    await select(1, 3);

    expect(bubble()?.style.left).toBe('250px');
    expect(bubble()?.style.top).toBe('88px');
  });

  it('keeps itself inside the viewport when the selection sits at the very edge', async () => {
    vi.spyOn(editor.view, 'coordsAtPos').mockReturnValue({
      left: -80,
      right: -80,
      top: 4,
      bottom: 20
    });

    await select(1, 3);

    expect(bubble()?.style.left).toBe('12px');
    expect(bubble()?.style.top).toBe('12px');
  });
});

describe('measurement', () => {
  it('measures the selection once per transaction, not once per event it fires', async () => {
    await select(1, 3);

    const coordsAtPos = vi.spyOn(editor.view, 'coordsAtPos');
    // A selection that genuinely moves — `selectionUpdate` only fires when it did.
    await select(2, 3);

    // Two positions — the selection's start and its end. Tiptap emits `transaction`
    // for every dispatch and `selectionUpdate` on top of it whenever the selection
    // moved, so listening to both makes the bubble re-measure the same transaction
    // twice, and every measurement forces layout.
    expect(coordsAtPos).toHaveBeenCalledTimes(2);
  });
});

describe('formatting', () => {
  const MARKS = [
    { title: '加粗', tag: 'strong' },
    { title: '斜体', tag: 'em' },
    { title: '行内代码', tag: 'code' }
  ];

  it.each(MARKS)('wraps the selected range in $tag and lights $title', async ({ title, tag }) => {
    await select(1, 3);
    expect(bubbleButton(title)?.classList.contains('is-active')).toBe(false);

    press(bubbleButton(title));
    await flush();

    expect(editor.getHTML()).toBe(`<p><${tag}>正文</${tag}></p>`);
    expect(bubbleButton(title)?.classList.contains('is-active')).toBe(true);
  });
});

describe('AI menu', () => {
  const aiButton = () => document.body.querySelector<HTMLButtonElement>('.ue-bubble__btn--ai');
  const menuItems = () =>
    Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-bubble .ue-menu__item'));

  it('offers no AI entry without a provider', async () => {
    await select(1, 3);

    expect(bubble()).not.toBeNull();
    expect(aiButton()).toBeNull();
  });

  it('offers no AI entry when the host configured no recognisable task', async () => {
    wrapper.unmount();
    editor.destroy();
    mountBubble({ hasAI: true, tasks: ['nonsense' as AITask] });

    await select(1, 3);

    expect(aiButton()).toBeNull();
  });

  it('lists exactly the tasks the host configured', async () => {
    wrapper.unmount();
    editor.destroy();
    mountBubble({ hasAI: true, tasks: ['improve', 'translate'] });
    await select(1, 3);

    press(aiButton());
    await nextTick();

    expect(aiButton()?.getAttribute('aria-haspopup')).toBe('menu');
    expect(aiButton()?.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('.ue-bubble .ue-menu')?.getAttribute('role')).toBe('menu');
    expect(menuItems().every((item) => item.getAttribute('role') === 'menuitem')).toBe(true);
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(['润色', '翻译']);
  });

  it('hands the picked task to the host and gets out of the way', async () => {
    wrapper.unmount();
    editor.destroy();
    mountBubble({ hasAI: true });
    await select(1, 3);

    press(aiButton());
    await nextTick();

    press(menuItems().find((item) => item.textContent?.trim() === '翻译'));
    await nextTick();

    expect(wrapper.emitted('ai')).toEqual([['translate']]);
    expect(bubble()).toBeNull();
  });

  it('closes the menu again on a second click of the AI button', async () => {
    wrapper.unmount();
    editor.destroy();
    mountBubble({ hasAI: true });
    await select(1, 3);

    press(aiButton());
    await nextTick();
    expect(menuItems()).not.toHaveLength(0);

    press(aiButton());
    await nextTick();
    expect(menuItems()).toHaveLength(0);
    expect(aiButton()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the bubble alive while its own menu holds the focus', async () => {
    wrapper.unmount();
    editor.destroy();
    mountBubble({ hasAI: true });
    await select(1, 3);

    press(aiButton());
    await nextTick();

    // Opening the menu takes focus off the document; the bubble must not vanish
    // out from under the menu the author is reading.
    editor.view.dom.blur();
    await nextTick();

    expect(bubble()).not.toBeNull();
    expect(menuItems()).not.toHaveLength(0);
  });
});

describe('dismissal', () => {
  it('closes bubble and menu together on a click anywhere outside', async () => {
    wrapper.unmount();
    editor.destroy();
    mountBubble({ hasAI: true });
    await select(1, 3);

    press(document.body.querySelector<HTMLButtonElement>('.ue-bubble__btn--ai'));
    await nextTick();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();

    expect(bubble()).toBeNull();
  });

  it('survives a click on its own buttons', async () => {
    await select(1, 3);

    bubbleButton('加粗')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();

    expect(bubble()).not.toBeNull();
  });

  it('takes itself down and stops listening when the editor chrome unmounts', async () => {
    await select(1, 3);
    expect(bubble()).not.toBeNull();

    wrapper.unmount();
    await nextTick();
    expect(bubble()).toBeNull();

    // A live editor must not be able to resurrect a bubble nobody is rendering.
    await select(1, 2);
    expect(bubble()).toBeNull();
  });
});
