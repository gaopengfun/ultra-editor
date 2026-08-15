import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit, type UltraKitOptions } from '../kit';

let editor: Editor;

function makeEditor(content = '<p></p>', options: UltraKitOptions = {}) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit(options) });
}

/**
 * jsdom has no ClipboardEvent with a populated `clipboardData`, so the event is
 * assembled by hand — which is also the only way to say "plain text but no HTML".
 *
 * The document is the assertion, not `defaultPrevented`: ProseMirror's own paste
 * handling calls `preventDefault` whether or not this extension claimed the event.
 */
function paste(target: Editor, data: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => data[type] ?? '' }
  });
  target.view.dom.dispatchEvent(event);
  return target.getHTML();
}

afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
});

describe('markdown paste', () => {
  it('converts pasted markdown into rich content', () => {
    editor = makeEditor();

    const html = paste(editor, { 'text/plain': '# 标题\n\n- 一\n- 二' });

    expect(html).toContain('<h1>标题</h1>');
    expect(html).toContain('<ul><li><p>一</p></li><li><p>二</p></li></ul>');
  });

  it('keeps a fenced block as a code block, language and all', () => {
    editor = makeEditor();

    const html = paste(editor, { 'text/plain': '```ts\nconst a = 1;\n```' });

    // The fence writes the language as a class; the document re-serialises it
    // onto the `<pre>` as well, which is where it survives being saved.
    expect(html).toContain(
      '<pre data-language="ts"><code class="language-ts">const a = 1;</code></pre>'
    );
  });

  it('leaves ordinary prose as the text it is', () => {
    editor = makeEditor('<p></p>');

    const html = paste(editor, { 'text/plain': '就是一段普通的话，带个 * 号。' });

    // The asterisk survives as an asterisk; nothing is restructured.
    expect(html).toBe('<p>就是一段普通的话，带个 * 号。</p>');
  });

  it('defers to the clipboard HTML when the source app provided some', () => {
    editor = makeEditor();

    // The source app already said what it meant; ProseMirror reads HTML better.
    const html = paste(editor, { 'text/plain': '# 标题', 'text/html': '<p>富文本</p>' });

    expect(html).toContain('富文本');
    expect(html).not.toContain('<h1>');
  });

  it('pastes markdown into a code block as the text it is', () => {
    editor = makeEditor('<pre><code>x</code></pre>');
    editor.commands.setTextSelection(2);

    const html = paste(editor, { 'text/plain': '# 标题' });

    expect(html).not.toContain('<h1>');
    expect(html).toContain('# 标题');
  });

  it('stays out of the way in a read-only editor', () => {
    editor = makeEditor('<p>只读</p>');
    editor.setEditable(false);

    expect(paste(editor, { 'text/plain': '# 标题' })).toBe('<p>只读</p>');
  });

  it('can be switched off at runtime through the getter', () => {
    let on = false;
    editor = makeEditor('<p></p>', { markdownPaste: () => on });

    expect(paste(editor, { 'text/plain': '# 标题' })).not.toContain('<h1>');

    editor.commands.clearContent();
    on = true;
    expect(paste(editor, { 'text/plain': '# 标题' })).toContain('<h1>标题</h1>');
  });

  it('ignores a paste event carrying no clipboard at all', () => {
    editor = makeEditor('<p>原文</p>');
    const event = new Event('paste', { bubbles: true, cancelable: true });

    expect(() => editor.view.dom.dispatchEvent(event)).not.toThrow();
    expect(editor.getHTML()).toBe('<p>原文</p>');
  });

  it('ignores an empty clipboard', () => {
    editor = makeEditor('<p>原文</p>');

    expect(paste(editor, { 'text/plain': '' })).toBe('<p>原文</p>');
  });
});
