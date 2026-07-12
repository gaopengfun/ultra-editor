import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit } from '../kit';

let editor: Editor;

function makeEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit() });
}

beforeEach(() => {
  document.body.innerHTML = '';
  editor = makeEditor();
});

afterEach(() => {
  if (!editor.isDestroyed) editor.destroy();
});

describe('table cell background', () => {
  // The DOM normalises inline styles, so hex goes in and rgb() comes back out.
  it('derives white text for a dark fill', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setTextSelection(6);
    editor.commands.setCellAttribute('backgroundColor', '#111111');

    const html = editor.getHTML();
    expect(html).toContain('background-color: rgb(17, 17, 17)');
    expect(html).toContain('color: rgb(255, 255, 255)');
  });

  it('derives near-black text for a light fill', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setTextSelection(6);
    editor.commands.setCellAttribute('backgroundColor', '#fef08a');

    expect(editor.getHTML()).toContain('color: rgb(31, 41, 55)');
  });

  it('colours a header cell too', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setTextSelection(2);
    editor.commands.setCellAttribute('backgroundColor', '#111111');

    const header = editor.getHTML().slice(0, editor.getHTML().indexOf('</tr>'));
    expect(header).toContain('<th');
    expect(header).toContain('background-color: rgb(17, 17, 17)');
    expect(header).toContain('color: rgb(255, 255, 255)');
  });

  it('writes no style at all for an uncoloured cell', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });

    expect(editor.getHTML()).not.toContain('background-color');
    expect(editor.getHTML()).not.toContain('color:');
  });

  it('drops the style again when the fill is cleared', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setTextSelection(6);
    editor.commands.setCellAttribute('backgroundColor', '#111111');
    editor.commands.setCellAttribute('backgroundColor', null);

    expect(editor.getHTML()).not.toContain('background-color');
  });

  it('reads a fill back off pasted HTML', () => {
    editor.commands.setContent(
      '<table><tbody>' +
        '<tr><th style="background-color: rgb(17, 17, 17)"><p>头</p></th></tr>' +
        '<tr><td style="background-color: rgb(254, 240, 138)"><p>身</p></td></tr>' +
        '</tbody></table>'
    );

    const html = editor.getHTML();
    // Round-tripped through the attribute, so the derived text colour comes back
    // with it — a document written elsewhere stays legible.
    expect(html).toContain('background-color: rgb(17, 17, 17); color: rgb(255, 255, 255)');
    expect(html).toContain('background-color: rgb(254, 240, 138); color: rgb(31, 41, 55)');
  });

  it('leaves an unstyled pasted cell uncoloured', () => {
    editor.commands.setContent('<table><tbody><tr><td><p>身</p></td></tr></tbody></table>');

    expect(editor.getHTML()).not.toContain('background-color');
  });
});
