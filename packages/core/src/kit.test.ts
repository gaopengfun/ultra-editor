import { beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit } from './kit';

function makeEditor(content = '') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit() });
}

let editor: Editor;

beforeEach(() => {
  document.body.innerHTML = '';
  editor = makeEditor();
});

describe('image', () => {
  it('round-trips a captioned, aligned figure', () => {
    editor.commands.setContent(
      '<figure class="ue-figure" data-align="center"><img src="/a.png"><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('<figure');
    expect(html).toContain('data-align="center"');
    expect(html).toContain('<figcaption>说明</figcaption>');
    expect(html).toContain('src="/a.png"');
  });

  it('still parses documents written with the old tiptap-figure class', () => {
    editor.commands.setContent(
      '<figure class="tiptap-figure" data-align="right"><img src="/legacy.png"><figcaption>旧文章</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('data-align="right"');
    expect(html).toContain('/legacy.png');
    expect(html).toContain('旧文章');
  });

  it('refuses to serialise a scripting-scheme image source', () => {
    editor.commands.setContent('<img src="javascript:alert(1)">');
    expect(editor.getHTML()).not.toContain('javascript:');
  });
});

describe('columns', () => {
  it('inserts a column block with the requested number of cards', () => {
    editor.commands.insertColumns(3);
    const html = editor.getHTML();

    expect(html).toContain('class="ue-columns"');
    expect(html).toContain('data-cols="3"');
    expect(html.match(/ue-column"/g)?.length).toBe(3);
  });

  it('clamps the count to the supported 1–5 range', () => {
    editor.commands.insertColumns(9);
    expect(editor.getHTML()).toContain('data-cols="5"');
  });

  it('refuses to nest a column block inside another', () => {
    editor.commands.insertColumns(2);
    // Put the cursor inside the first card, then try again.
    editor.commands.setTextSelection(3);
    expect(editor.commands.insertColumns(2)).toBe(false);
  });

  it('parses legacy tiptap-column markup', () => {
    editor.commands.setContent(
      '<div class="tiptap-columns"><div class="tiptap-column"><p>a</p></div><div class="tiptap-column"><p>b</p></div></div>'
    );
    expect(editor.getHTML()).toContain('data-cols="2"');
  });
});

describe('code block', () => {
  it('keeps the chosen language in the serialised HTML', () => {
    editor.commands.setContent('<pre><code class="language-typescript">const a = 1</code></pre>');
    const html = editor.getHTML();

    expect(html).toContain('<pre><code class="language-typescript">');
    expect(html).toContain('const a = 1');
  });

  it('holds more than one line', () => {
    editor.commands.setContent('<pre><code>a\nb</code></pre>');
    expect(editor.getHTML()).toContain('a\nb');
  });

  it('leaves the editing chrome out of the serialised HTML', () => {
    editor.commands.setContent('<pre><code>x</code></pre>');
    const html = editor.getHTML();

    // The language picker and copy button are a node view: they exist while
    // writing and must never reach a published article.
    expect(html).not.toContain('ue-codeblock');
    expect(html).not.toContain('<select');
    expect(html).toContain('<pre><code>x</code></pre>');
  });

  it('draws the picker and the copy button on the block while editing', () => {
    editor.commands.setContent('<pre><code class="language-css">a{}</code></pre>');
    const bar = editor.view.dom.querySelector('.ue-codeblock__bar');

    expect(bar).not.toBeNull();
    expect(bar?.querySelector('.ue-codeblock__lang')?.textContent).toBe('CSS');
  });

  it('picks a language from its own menu rather than a native select', () => {
    editor.commands.setContent('<pre><code>a</code></pre>');
    const trigger = editor.view.dom.querySelector<HTMLButtonElement>('.ue-codeblock__lang');
    trigger?.click();

    const list = document.querySelector('.ue-codeblock__langs');
    expect(list).not.toBeNull();

    const rust = Array.from(list?.querySelectorAll<HTMLButtonElement>('.ue-menu__item') ?? []).find(
      (item) => item.textContent === 'Rust'
    );
    rust?.click();

    expect(editor.getHTML()).toContain('class="language-rust"');
    // The list is teleported to <body>; picking has to take it back down again.
    expect(document.querySelector('.ue-codeblock__langs')).toBeNull();
  });
});

describe('table', () => {
  it('serialises a cell background with a readable text colour', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setCellAttribute('backgroundColor', '#111111');

    // The DOM normalises the inline style, so hex comes back out as rgb().
    const html = editor.getHTML();
    expect(html).toContain('background-color: rgb(17, 17, 17)');
    // Dark fill → white text, derived rather than stored.
    expect(html).toContain('color: rgb(255, 255, 255)');
  });

  it('derives near-black text for a light fill', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setCellAttribute('backgroundColor', '#fef08a');

    expect(editor.getHTML()).toContain('color: rgb(31, 41, 55)');
  });

  it('persists a dragged row height as an inline style', () => {
    editor.commands.setContent(
      '<table><tbody><tr style="height: 80px"><td><p>a</p></td></tr></tbody></table>'
    );
    expect(editor.getHTML()).toContain('height: 80px');
  });
});
