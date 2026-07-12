import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit } from '../kit';
import { ColumnBlock, MAX_COLUMNS, MIN_COLUMNS } from './columns';

let editor: Editor;

function makeEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit() });
}

function toolbar() {
  return editor.view.dom.querySelector<HTMLElement>('.ue-columns__toolbar')!;
}

function buttons() {
  return Array.from(toolbar().querySelectorAll<HTMLButtonElement>('.ue-columns__btn'));
}

/** The toolbar is [add, remove, delete], in that order. */
function addButton() {
  return buttons()[0];
}
function removeButton() {
  return buttons()[1];
}
function deleteButton() {
  return buttons()[2];
}

function cardCount() {
  return editor.view.dom.querySelectorAll('.ue-column').length;
}

beforeEach(() => {
  document.body.innerHTML = '';
  editor = makeEditor();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (!editor.isDestroyed) editor.destroy();
});

/** PM flushes its DOM observer on a timer; nothing reaches the node view before it does. */
const flushDOM = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('insertColumns', () => {
  it('defaults to a two-card row', () => {
    editor.commands.insertColumns();
    expect(editor.getHTML()).toContain('data-cols="2"');
  });

  it('clamps a count below the supported range up to one card', () => {
    editor.commands.insertColumns(0);
    expect(editor.getHTML()).toContain(`data-cols="${MIN_COLUMNS}"`);
    expect(cardCount()).toBe(MIN_COLUMNS);
  });

  it('clamps a negative count up to one card', () => {
    editor.commands.insertColumns(-4);
    expect(cardCount()).toBe(MIN_COLUMNS);
  });

  it('clamps a count above the supported range down to five cards', () => {
    editor.commands.insertColumns(99);
    expect(cardCount()).toBe(MAX_COLUMNS);
  });

  it('rounds a fractional count', () => {
    editor.commands.insertColumns(2.6);
    expect(cardCount()).toBe(3);
  });

  it('refuses to nest a column block inside a card', () => {
    editor.commands.insertColumns(2);
    editor.commands.setTextSelection(3);

    expect(editor.commands.insertColumns(2)).toBe(false);
    expect(editor.getHTML().match(/ue-columns"/g)).toHaveLength(1);
  });
});

describe('column block toolbar', () => {
  beforeEach(() => {
    editor.commands.insertColumns(2);
  });

  it('stays out of the serialised HTML', () => {
    const html = editor.getHTML();

    // The toolbar is node view chrome: it exists while editing and must never
    // reach a published article.
    expect(html).not.toContain('ue-columns__toolbar');
    expect(html).not.toContain('<button');
    expect(html).toContain('class="ue-columns" data-cols="2"');
  });

  it('adds a card and republishes the count', () => {
    addButton().click();

    expect(cardCount()).toBe(3);
    expect(editor.getHTML()).toContain('data-cols="3"');
    // The node view keeps its own contentDOM in step, which is what the CSS grid reads.
    expect(editor.view.dom.querySelector('.ue-columns')?.getAttribute('data-cols')).toBe('3');
  });

  it('removes the last card and republishes the count', () => {
    removeButton().click();

    expect(cardCount()).toBe(1);
    expect(editor.getHTML()).toContain('data-cols="1"');
  });

  it('deletes the whole row', () => {
    deleteButton().click();

    expect(editor.getHTML()).not.toContain('ue-columns');
    expect(editor.view.dom.querySelector('.ue-columns-wrapper')).toBeNull();
  });

  it('disables adding at five cards and refuses the click anyway', () => {
    for (let i = 2; i < MAX_COLUMNS; i++) addButton().click();
    expect(cardCount()).toBe(MAX_COLUMNS);
    expect(addButton().disabled).toBe(true);

    // `disabled` is chrome, not enforcement — a click that gets through must not
    // grow the row past what the schema allows.
    addButton().click();
    expect(cardCount()).toBe(MAX_COLUMNS);
  });

  it('disables removing at one card and refuses the click anyway', () => {
    removeButton().click();
    expect(cardCount()).toBe(MIN_COLUMNS);
    expect(removeButton().disabled).toBe(true);

    removeButton().click();
    expect(cardCount()).toBe(MIN_COLUMNS);
  });

  it('keeps the selection alive when a button is pressed', () => {
    editor.commands.setTextSelection(3);
    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    addButton().dispatchEvent(mousedown);

    // Without preventDefault the editor blurs and the selection jumps away before
    // the click handler ever runs.
    expect(mousedown.defaultPrevented).toBe(true);
  });

  it('keeps a key press on the toolbar out of the document', () => {
    editor.commands.setTextSelection(3);
    const before = editor.getHTML();

    addButton().dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
    );

    expect(editor.getHTML()).toBe(before);
  });

  it('ignores a button press once the row is gone', () => {
    const add = addButton();
    const remove = removeButton();
    const del = deleteButton();
    editor.commands.setContent('<p>没有分栏</p>');

    // The buttons are detached but still live; their position resolves to nothing.
    expect(() => {
      add.click();
      remove.click();
      del.click();
    }).not.toThrow();
    expect(editor.getHTML()).toBe('<p>没有分栏</p>');
  });
});

describe('column block parsing', () => {
  it('parses legacy tiptap-column markup', () => {
    editor.commands.setContent(
      '<div class="tiptap-columns">' +
        '<div class="tiptap-column"><p>甲</p></div>' +
        '<div class="tiptap-column"><p>乙</p></div>' +
        '</div>'
    );

    expect(editor.getHTML()).toContain('data-cols="2"');
    expect(cardCount()).toBe(2);
  });

  it('survives typing inside a card', () => {
    editor.commands.insertColumns(2);
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('文字');

    expect(editor.getHTML()).toContain('<p>文字</p>');
    expect(editor.getHTML()).toContain('data-cols="2"');
  });
});

describe('column block DOM changes', () => {
  beforeEach(() => {
    editor.commands.insertColumns(2);
  });

  it('keeps a stray change to the toolbar out of the document', async () => {
    const before = editor.getHTML();

    // Browsers and extensions do touch the chrome; reading it back would parse the
    // buttons into the document.
    toolbar().setAttribute('data-injected', '1');
    await flushDOM();

    expect(editor.getHTML()).toBe(before);
  });

  it('reads a change inside a card back into the document', async () => {
    const card = editor.view.dom.querySelector('.ue-column p')!;
    card.appendChild(document.createTextNode('浏览器写的字'));
    await flushDOM();

    expect(editor.getHTML()).toContain('<p>浏览器写的字</p>');
  });

  it('treats a selection across the cards as a selection, not an edit', async () => {
    const before = editor.getHTML();
    // jsdom will not focus a contenteditable div on its own.
    editor.view.dom.setAttribute('tabindex', '0');
    editor.view.dom.focus();

    const cards = editor.view.dom.querySelector('.ue-columns')!;
    const range = document.createRange();
    range.setStart(cards, 0);
    range.setEnd(cards, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushDOM();

    expect(editor.getHTML()).toBe(before);
  });
});

describe('column block outside a browser', () => {
  it('hands ProseMirror no node view when there is no DOM', () => {
    vi.stubGlobal('window', undefined);

    // The SDK is imported in SSR apps; the toolbar must not reach for `document`.
    const extension = ColumnBlock.configure({});
    expect(extension.config.addNodeView?.call(extension as never)).toBeNull();
  });
});
