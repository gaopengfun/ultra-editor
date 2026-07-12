import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit } from '../kit';

const TWO_ROWS =
  '<table><tbody>' +
  '<tr><td><p>甲</p></td><td><p>乙</p></td></tr>' +
  '<tr><td><p>丙</p></td><td><p>丁</p></td></tr>' +
  '</tbody></table><p>结尾</p>';

const editors: Editor[] = [];

function makeEditor(content: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = new Editor({ element, content, extensions: createUltraKit() });
  editors.push(instance);
  return instance;
}

/**
 * jsdom lays nothing out, so every rect is zero. The plugin's grab zone is real
 * geometry, so a row has to be given one before a drag means anything.
 */
function layout(row: Element, top: number, height: number) {
  row.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top
    }) as DOMRect;
}

function mouse(target: EventTarget, type: string, clientY = 0) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
}

let editor: Editor;

function rows() {
  return Array.from(editor.view.dom.querySelectorAll('tr'));
}

function marked() {
  return Array.from(editor.view.dom.querySelectorAll('.ue-row-resize-target'));
}

beforeEach(() => {
  document.body.innerHTML = '';
  // prosemirror-tables' column resizer answers the same mouse events and calls
  // posAtCoords, which jsdom cannot serve. Without this it throws over the top of
  // every assertion here.
  document.elementFromPoint = () => null;
  editor = makeEditor(TWO_ROWS);
});

afterEach(() => {
  while (editors.length) {
    const instance = editors.pop();
    if (instance && !instance.isDestroyed) instance.destroy();
  }
});

describe('ResizableTableRow height attribute', () => {
  it('reads an existing inline height back off the DOM', () => {
    editor.commands.setContent(
      '<table><tbody><tr style="height: 80px"><td><p>甲</p></td></tr></tbody></table>'
    );
    expect(editor.getHTML()).toContain('height: 80px');
  });

  it('ignores a row height that is not a pixel number', () => {
    editor.commands.setContent(
      '<table><tbody><tr style="height: auto"><td><p>甲</p></td></tr></tbody></table>'
    );
    expect(editor.getHTML()).not.toContain('height');
  });
});

describe('ResizableTableRow drag', () => {
  it('persists a dragged row height as an inline style', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first.querySelector('td')!, 'mousedown', 40);
    mouse(document, 'mousemove', 100);
    mouse(document, 'mouseup', 100);

    // 40px tall, dragged 60px down.
    expect(editor.getHTML()).toContain('height: 100px');
  });

  it('tracks the height on the row itself before the drop commits it', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 40);
    mouse(document, 'mousemove', 90);

    expect(first.style.height).toBe('90px');
    // Nothing is written to the document until the pointer comes up.
    expect(editor.getHTML()).not.toContain('height:');

    mouse(document, 'mouseup', 90);
    expect(editor.getHTML()).toContain('height: 90px');
  });

  it('clamps a row dragged past the top to the minimum height', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 40);
    mouse(document, 'mouseup', -500);

    expect(editor.getHTML()).toContain('height: 24px');
  });

  it('marks the resizing editor while the pointer is down', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 40);
    expect(editor.view.dom.classList.contains('ue-row-resizing')).toBe(true);

    mouse(document, 'mouseup', 40);
    expect(editor.view.dom.classList.contains('ue-row-resizing')).toBe(false);
    expect(editor.view.dom.style.cursor).toBe('');
  });

  it('leaves no document listeners behind once the pointer comes up', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 40);
    mouse(document, 'mouseup', 100);

    const committed = editor.view.dom.querySelector('tr')!;
    const height = (committed as HTMLElement).style.height;
    mouse(document, 'mousemove', 400);

    expect((committed as HTMLElement).style.height).toBe(height);
  });

  it('takes its document listeners with it when the editor is destroyed mid-drag', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 40);
    editor.destroy();

    // A listener that outlives the view would fire against a dead one.
    expect(() => mouse(document, 'mousemove', 400)).not.toThrow();
    expect(first.style.height).toBe('');
  });

  it('drops a height for a row that was deleted mid-drag', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 40);
    editor.commands.setContent('<p>表格没了</p>');
    mouse(document, 'mouseup', 100);

    expect(editor.getHTML()).toBe('<p>表格没了</p>');
  });

  it('commits a drag against the row it grabbed once the mark has been cleared', () => {
    const [first, second] = rows();
    layout(first, 0, 40);
    layout(second, 40, 60);

    // A browser can swallow a mouseup — released outside the window, pressed
    // again — which leaves the first drag armed while a second one starts. Both
    // pointer-ups then fire; the first clears the plugin's mark, so the second
    // finds nothing there and has only the row it grabbed to go on.
    mouse(first, 'mousedown', 40);
    mouse(second, 'mousedown', 100);
    mouse(document, 'mouseup', 150);

    const [top, bottom] = rows();
    expect(bottom.style.height).toBe('110px');
    expect(top.style.height).toBe('');
  });

  it('ignores a mousedown that is nowhere near the row edge', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousedown', 5);
    mouse(document, 'mousemove', 200);
    mouse(document, 'mouseup', 200);

    expect(first.style.height).toBe('');
    expect(editor.getHTML()).not.toContain('height');
  });
});

describe('ResizableTableRow indicator', () => {
  it('marks every cell of the row under the pointer', () => {
    const [first] = rows();
    layout(first, 0, 40);

    mouse(first, 'mousemove', 41);

    expect(editor.view.dom.style.cursor).toBe('row-resize');
    expect(marked().map((cell) => cell.textContent)).toEqual(['甲', '乙']);
  });

  it('clears the mark when the pointer moves off the table', () => {
    const [first] = rows();
    layout(first, 0, 40);
    mouse(first, 'mousemove', 41);

    mouse(editor.view.dom.querySelector(':scope > p')!, 'mousemove', 41);

    expect(editor.view.dom.style.cursor).toBe('');
    expect(marked()).toHaveLength(0);
  });

  it('clears the mark when the pointer leaves the editor', () => {
    const [first] = rows();
    layout(first, 0, 40);
    mouse(first, 'mousemove', 41);

    mouse(editor.view.dom, 'mouseleave');

    expect(marked()).toHaveLength(0);
    // Already clear — leaving again must not dispatch a second time.
    expect(() => mouse(editor.view.dom, 'mouseleave')).not.toThrow();
    expect(marked()).toHaveLength(0);
  });

  it('keeps the mark on the same row when the document changes above it', () => {
    const [, second] = rows();
    layout(second, 40, 40);
    mouse(second, 'mousemove', 80);

    editor.commands.insertContentAt(0, '<p>插入的段落</p>');

    expect(marked().map((cell) => cell.textContent)).toEqual(['丙', '丁']);
  });

  it('drops the mark when the row it tracked is replaced by other content', () => {
    const [first] = rows();
    layout(first, 0, 40);
    mouse(first, 'mousemove', 41);

    editor.commands.setContent('<p>只剩文字</p>');

    expect(marked()).toHaveLength(0);
  });

  it('drops the mark when the document is emptied under it', () => {
    const [first] = rows();
    layout(first, 0, 40);
    mouse(first, 'mousemove', 41);

    editor.commands.clearContent();

    expect(marked()).toHaveLength(0);
  });

  it('keeps the dragged row marked as the pointer crosses another one', () => {
    const [first, second] = rows();
    layout(first, 0, 40);
    layout(second, 40, 40);

    mouse(first, 'mousemove', 41);
    mouse(first, 'mousedown', 41);
    // Mid-drag the pointer sweeps over the second row's edge; the mark must not
    // jump to it, or the indicator would abandon the row being resized.
    mouse(second, 'mousemove', 80);
    mouse(editor.view.dom, 'mouseleave');

    expect(marked().map((cell) => cell.textContent)).toEqual(['甲', '乙']);

    mouse(document, 'mouseup', 80);
  });
});

describe('ResizableTableRow edge cases', () => {
  it('ignores a table row that belongs to the page rather than the editor', () => {
    document.body.innerHTML = '';
    const table = document.createElement('table');
    table.innerHTML = '<tbody><tr><td></td></tr></tbody>';
    document.body.appendChild(table);

    const cell = table.querySelector('td')!;
    const element = document.createElement('div');
    cell.appendChild(element);
    const nested = new Editor({ element, content: '<p>文字</p>', extensions: createUltraKit() });
    editors.push(nested);

    // The editor is laid out inside someone else's table; its own paragraph must
    // not offer to resize their row.
    layout(table.querySelector('tr')!, 0, 40);
    mouse(nested.view.dom.querySelector('p')!, 'mousemove', 40);

    expect(nested.view.dom.style.cursor).toBe('');
  });

  it('offers no handle for a row that is not part of the document', () => {
    // A <tr> can be injected into the DOM without being in the document — a paste
    // artefact, an extension, a mid-flush browser fixup. It has no row to resize.
    const stray = document.createElement('tr');
    editor.view.dom.querySelector(':scope > p')!.appendChild(stray);

    mouse(stray, 'mousemove', 0);

    expect(editor.view.dom.style.cursor).toBe('');
    expect(marked()).toHaveLength(0);
  });

  it('survives a mouse event that targets a text node', () => {
    const text = editor.view.dom.querySelector('td p')!.firstChild!;

    // A Text has no `closest`; the handler must not assume every target is an element.
    expect(() => mouse(text, 'mousemove', 0)).not.toThrow();
    expect(editor.view.dom.style.cursor).toBe('');
  });
});
