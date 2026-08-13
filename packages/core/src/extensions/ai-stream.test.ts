import { beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createUltraKit } from '../kit';
import { aiStreamRange, isAIStreaming, isAIStreamTransaction } from './ai-stream';

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

  it('keeps a single newline as a line break inside one paragraph', () => {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.aiStreamStart();
    // A chunk that lands mid-line is the normal case: the trailing newline must
    // not become a literal character, nor an empty text node.
    editor.commands.aiStreamSet('第一行\n');
    editor.commands.aiStreamSet('第一行\n第二行');
    editor.commands.aiStreamAccept();

    expect(editor.getHTML()).toContain('<p>第一行<br>第二行</p>');
  });

  it('renders an empty chunk as nothing at all', () => {
    const before = editor.getHTML();
    editor.commands.setTextSelection(3);
    editor.commands.aiStreamStart();

    // The first chunk off the wire is routinely empty.
    expect(editor.commands.aiStreamSet('')).toBe(true);
    expect(editor.getHTML()).toBe(before);
  });

  it('accepts a generation that produced nothing without touching the document', () => {
    const before = editor.getHTML();

    editor.commands.setTextSelection(3);
    editor.commands.aiStreamStart();
    expect(editor.commands.aiStreamAccept()).toBe(true);

    expect(editor.getHTML()).toBe(before);
    expect(aiStreamRange(editor.state)).toBeNull();
  });

  it('answers a can() probe without writing anything', () => {
    const before = editor.getHTML();

    // A `can()` probe runs the command with no dispatch: every one of them has to
    // answer without touching the document.
    expect(editor.can().aiStreamStart()).toBe(true);
    expect(aiStreamRange(editor.state)).toBeNull();

    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('生成的内容');

    expect(editor.can().aiStreamSet('别的内容')).toBe(true);
    expect(editor.can().aiStreamAccept()).toBe(true);
    expect(editor.can().aiStreamDiscard()).toBe(true);
    expect(editor.getHTML()).toContain('生成的内容');
    expect(aiStreamRange(editor.state)).not.toBeNull();

    editor.commands.aiStreamDiscard();
    expect(editor.getHTML()).toBe(before);
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

  it('marks provisional transactions but leaves the accepted edit ordinary', () => {
    const provisional: boolean[] = [];
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) provisional.push(isAIStreamTransaction(transaction));
    });

    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('生成的内容');
    editor.commands.aiStreamAccept();

    expect(provisional).toEqual([true, true, false]);
  });

  it('refuses to start a second generation while one is running', () => {
    editor.commands.aiStreamStart();
    expect(editor.commands.aiStreamStart()).toBe(false);
  });

  it('reports whether a generation is in flight', () => {
    expect(isAIStreaming(editor.state)).toBe(false);

    editor.commands.aiStreamStart();
    expect(isAIStreaming(editor.state)).toBe(true);

    editor.commands.aiStreamDiscard();
    expect(isAIStreaming(editor.state)).toBe(false);
  });

  it('refuses to set, accept or discard when nothing is streaming', () => {
    expect(editor.commands.aiStreamSet('文本')).toBe(false);
    expect(editor.commands.aiStreamAccept()).toBe(false);
    expect(editor.commands.aiStreamDiscard()).toBe(false);
  });

  it('writes at the block boundary when the selection is a node, not a cursor', () => {
    editor.commands.setContent('<p>正文</p><hr><p>结尾</p>');
    // A horizontal rule has no textblock to write into: the region has to open at
    // the document level rather than hunt for a block that isn't there.
    editor.commands.setNodeSelection(4);

    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('AI 段落');
    editor.commands.aiStreamAccept();

    expect(editor.getHTML()).toBe('<p>正文</p><hr><p>AI 段落</p><p>结尾</p>');
  });

  it('writes inside the quote when a quoted paragraph is selected as a node', () => {
    editor.commands.setContent('<blockquote><p>引用</p></blockquote>');
    // The selection's end resolves inside the blockquote, which is not a textblock —
    // the target has to climb out of it rather than write into the wrapper itself.
    editor.commands.setNodeSelection(1);

    editor.commands.aiStreamStart();
    editor.commands.aiStreamSet('AI 段落');
    editor.commands.aiStreamAccept();

    expect(editor.getHTML()).toContain('<blockquote><p>引用</p><p>AI 段落</p></blockquote>');
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
