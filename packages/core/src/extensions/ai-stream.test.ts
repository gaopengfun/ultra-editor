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

  // The `/write` shape: the slash text is deleted first, so the generation starts
  // from an empty paragraph, which the streaming region replaces outright.
  //
  // These build their own editor rather than calling setContent — setContent is
  // itself an undoable step, and ProseMirror's history would group it with the
  // accept that follows milliseconds later, making one undo look like two.
  describe('generating from an empty block', () => {
    let blank: Editor;

    beforeEach(() => {
      blank = makeEditor('<p>正文</p><p></p>');
      blank.commands.setTextSelection(blank.state.doc.content.size - 1);
    });

    it('gives the empty paragraph back on undo, not just the generated text', () => {
      const before = blank.getHTML();

      blank.commands.aiStreamStart();
      blank.commands.aiStreamSet('AI 段落');
      blank.commands.aiStreamAccept();
      expect(blank.getHTML()).toBe('<p>正文</p><p>AI 段落</p>');

      blank.commands.undo();
      expect(blank.getHTML()).toBe(before);
    });

    it('gives the empty paragraph back on discard', () => {
      const before = blank.getHTML();

      blank.commands.aiStreamStart();
      blank.commands.aiStreamSet('AI 段落');
      blank.commands.aiStreamDiscard();

      expect(blank.getHTML()).toBe(before);
    });

    // Regression: a click before the user decides is a selection-only
    // transaction that runs through the region's position-mapping branch. That
    // branch used to rebuild the range without `consumedEmptyBlock`, so the
    // swallowed paragraph was forgotten and discard/undo lost it.
    it('restores the empty paragraph on discard after a click moves the selection', () => {
      const before = blank.getHTML();

      blank.commands.aiStreamStart();
      blank.commands.aiStreamSet('AI 段落');
      blank.commands.setTextSelection(1);
      blank.commands.aiStreamDiscard();

      expect(blank.getHTML()).toBe(before);
    });

    it('gives the empty paragraph back on undo after a click moves the selection', () => {
      const before = blank.getHTML();

      blank.commands.aiStreamStart();
      blank.commands.aiStreamSet('AI 段落');
      blank.commands.setTextSelection(1);
      blank.commands.aiStreamAccept();
      expect(blank.getHTML()).toBe('<p>正文</p><p>AI 段落</p>');

      blank.commands.undo();
      expect(blank.getHTML()).toBe(before);
    });
  });
});
