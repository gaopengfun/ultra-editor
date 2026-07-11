import { beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit } from '../kit';
import { aiStreamRange } from './ai-stream';

function makeEditor(content: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit() });
}

let editor: Editor;

beforeEach(() => {
  document.body.innerHTML = '';
  editor = makeEditor('<h2>标题</h2><p>正文一</p>');
});

describe('AIStream', () => {
  it('writes after the current block instead of splitting it', () => {
    // Cursor in the middle of the heading — the naive implementation tore the
    // heading in half and stranded an empty one behind.
    editor.commands.setTextSelection(3);
    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('生成的内容');
    editor.commands.aiStreamAccept();

    const html = editor.getHTML();
    expect(html).toBe('<h2>标题</h2><p>生成的内容</p><p>正文一</p>');
    expect(html).not.toContain('<h2></h2>');
  });

  it('replaces an empty block rather than writing around it', () => {
    editor.commands.setContent('<p>正文</p><p></p>');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('AI 段落');
    editor.commands.aiStreamAccept();

    expect(editor.getHTML()).toBe('<p>正文</p><p>AI 段落</p>');
  });

  it('turns blank-line-separated output into separate paragraphs', () => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('第一段\n\n第二段');
    editor.commands.aiStreamAccept();

    const html = editor.getHTML();
    expect(html).toContain('<p>第一段</p>');
    expect(html).toContain('<p>第二段</p>');
  });

  it('leaves no trace when the generation is discarded', () => {
    const before = editor.getHTML();

    editor.commands.setTextSelection(3);
    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('一些');
    editor.commands.aiStreamSet('一些流式内容');
    editor.commands.aiStreamDiscard();

    expect(editor.getHTML()).toBe(before);
    expect(aiStreamRange(editor.state)).toBeNull();
  });

  it('collapses an accepted generation into a single undo step', () => {
    const before = editor.getHTML();

    editor.commands.setTextSelection(3);
    editor.commands.aiStreamStart();
    // Every streamed chunk is its own transaction; none of them may reach history.
    for (const text of ['生', '生成', '生成的', '生成的内容']) {
      editor.commands.aiStreamSet(text);
    }
    editor.commands.aiStreamAccept();

    expect(editor.getHTML()).toContain('生成的内容');

    editor.commands.undo();
    expect(editor.getHTML()).toBe(before);
  });

  it('refuses to start a second generation while one is running', () => {
    editor.commands.aiStreamStart();
    expect(editor.commands.aiStreamStart()).toBe(false);
  });
});
