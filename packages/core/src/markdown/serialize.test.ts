import { describe, expect, it } from 'vitest';
import { Editor, Node as TiptapNode } from '@tiptap/core';
import { createUltraKit } from '../kit';
import { ImageFigure } from '../extensions/image-figure';
import { docToMarkdown } from './serialize';
import { markdownToHTML } from './parse';
import { looksLikeMarkdown } from './index';

function editorWith(html: string) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content: html, extensions: createUltraKit() });
}

/** HTML in, Markdown out. */
function toMarkdown(html: string): string {
  const editor = editorWith(html);
  const markdown = docToMarkdown(editor.state.doc);
  editor.destroy();
  return markdown;
}

/** Markdown → document → Markdown. What survives a save-and-reopen. */
function roundTrip(markdown: string): string {
  const editor = editorWith(markdownToHTML(markdown));
  const out = docToMarkdown(editor.state.doc);
  editor.destroy();
  return out;
}

describe('document to markdown', () => {
  it('writes headings, paragraphs and rules', () => {
    expect(toMarkdown('<h1>标题</h1><p>正文</p><hr>')).toBe('# 标题\n\n正文\n\n---');
    expect(toMarkdown('<h3>三级</h3>')).toBe('### 三级');
  });

  it('writes the inline marks it has syntax for', () => {
    expect(toMarkdown('<p><strong>b</strong> <em>i</em> <s>d</s></p>')).toBe('**b** *i* ~~d~~');
    expect(toMarkdown('<p><code>x</code></p>')).toBe('`x`');
    expect(toMarkdown('<p><a href="https://x.com">a</a></p>')).toBe('[a](https://x.com)');
  });

  it('keeps the text of a mark markdown cannot express', () => {
    // Underline has no Markdown; losing the styling is fine, losing the word is not.
    expect(toMarkdown('<p><u>下划线</u></p>')).toBe('下划线');
  });

  it('escapes a literal tilde so it cannot come back as syntax', () => {
    // Unescaped, `~~x~~` returns as a strikethrough nobody applied — and a
    // paragraph of `~~~` opens a fence that swallows the rest of the document.
    expect(toMarkdown('<p>~~开心~~啦</p>')).toBe('\\~\\~开心\\~\\~啦');
    expect(markdownToHTML(toMarkdown('<p>~~开心~~啦</p>'))).toBe('<p>~~开心~~啦</p>');
    expect(markdownToHTML(toMarkdown('<p>~~~</p><p>后面的正文</p>'))).toBe(
      '<p>~~~</p><p>后面的正文</p>'
    );
  });

  it('still writes a real strikethrough, tildes in its text and all', () => {
    expect(toMarkdown('<p><s>删</s></p>')).toBe('~~删~~');
    expect(markdownToHTML(toMarkdown('<p><s>a~b</s></p>'))).toBe('<p><s>a~b</s></p>');
  });

  it('escapes a leading number by its punctuation, not its digits', () => {
    // `\1.` is not a valid escape — Markdown only escapes punctuation — so the
    // backslash comes back as text and the author sees one they never typed.
    expect(toMarkdown('<p>1. 正文</p>')).toBe('1\\. 正文');
    expect(toMarkdown('<p>2) 第二</p>')).toBe('2\\) 第二');
    expect(markdownToHTML(toMarkdown('<p>1. 正文</p>'))).toBe('<p>1. 正文</p>');
    expect(markdownToHTML(toMarkdown('<p>2024. 全年营收</p>'))).toBe('<p>2024. 全年营收</p>');
  });

  it('writes a code span that itself contains backticks', () => {
    expect(toMarkdown('<p><code>a`b</code></p>')).toBe('``a`b``');
    // A backtick at the very edge needs padding, or the fences run together.
    expect(toMarkdown('<p><code>`x`</code></p>')).toBe('`` `x` ``');
  });

  it('writes a link with no href as its text', () => {
    const editor = editorWith('<p>文字</p>');
    editor.chain().selectAll().setMark('link', { href: null }).run();
    const markdown = docToMarkdown(editor.state.doc);
    editor.destroy();

    // `[文字]()` would only read back as broken syntax.
    expect(markdown).toBe('文字');
  });

  // A bare destination cannot hold whitespace, and can only hold parentheses
  // that pair up. Written bare, each of these reads back as literal text or as a
  // truncated URL — the link is lost on the way through source mode.
  it('wraps a URL that a bare destination could not carry', () => {
    expect(toMarkdown('<p><a href="https://x.com/a b">t</a></p>')).toBe('[t](<https://x.com/a b>)');
    expect(toMarkdown('<p><a href="https://x.com/a(b">t</a></p>')).toBe('[t](<https://x.com/a(b>)');
    expect(toMarkdown('<p><a href="https://x.com/a)b">t</a></p>')).toBe('[t](<https://x.com/a)b>)');
    expect(toMarkdown('<p><img src="https://x.com/a b.png" alt="a"></p>')).toBe(
      '![a](<https://x.com/a b.png>)'
    );
  });

  it('leaves a URL with balanced parentheses bare', () => {
    expect(toMarkdown('<p><a href="https://x.com/a(b)">t</a></p>')).toBe('[t](https://x.com/a(b))');
    expect(toMarkdown('<p><a href="https://x.com/a">t</a></p>')).toBe('[t](https://x.com/a)');
  });

  it('pads a row that a merged cell left short', () => {
    const html =
      '<table><tbody><tr><th><p>甲</p></th><th><p>乙</p></th></tr>' +
      '<tr><td colspan="2"><p>合并</p></td></tr></tbody></table>';

    expect(toMarkdown(html)).toBe('| 甲 | 乙 |\n| --- | --- |\n| 合并 |  |');
  });

  it('separates a list item that holds more than one paragraph', () => {
    expect(toMarkdown('<ul><li><p>一段</p><p>二段</p></li></ul>')).toBe('- 一段\n\n  二段');
  });

  it('skips an empty paragraph inside a list item', () => {
    // The bullet stays — the item exists — but with no trailing space, which some
    // renderers would otherwise read as a hard break.
    expect(toMarkdown('<ul><li><p></p></li><li><p>有字</p></li></ul>')).toBe('-\n- 有字');
  });

  it('writes lists, nested and ordered', () => {
    expect(toMarkdown('<ul><li><p>a</p></li><li><p>b</p></li></ul>')).toBe('- a\n- b');
    expect(toMarkdown('<ol><li><p>a</p></li><li><p>b</p></li></ol>')).toBe('1. a\n2. b');
    expect(toMarkdown('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul>')).toBe('- a\n  - b');
  });

  it('writes a blockquote with every line prefixed', () => {
    expect(toMarkdown('<blockquote><p>a</p><p>b</p></blockquote>')).toBe('> a\n>\n> b');
  });

  it('writes a fenced code block with its language', () => {
    expect(toMarkdown('<pre><code class="language-ts">const a = 1;</code></pre>')).toBe(
      '```ts\nconst a = 1;\n```'
    );
    expect(toMarkdown('<pre><code>plain</code></pre>')).toBe('```\nplain\n```');
  });

  it('lengthens the fence when the code contains one', () => {
    expect(toMarkdown('<pre><code>```</code></pre>')).toBe('````\n```\n````');
  });

  it('writes an image, preferring its caption as the alt text', () => {
    expect(toMarkdown('<p><img src="/a.png" alt="图"></p>')).toBe('![图](/a.png)');
    expect(
      toMarkdown(
        '<figure class="ue-figure"><img src="/a.png"><figcaption>说明</figcaption></figure>'
      )
    ).toBe('![说明](/a.png)');
  });

  it('writes an image with neither caption nor alt', () => {
    expect(toMarkdown('<img src="/a.png">')).toBe('![](/a.png)');
  });

  it('carries an image title across', () => {
    expect(toMarkdown('<img src="/a.png" alt="图" title="标题">')).toBe('![图](/a.png "标题")');
  });

  it('writes an image node that has no source yet', () => {
    const editor = editorWith('<p></p>');
    editor.commands.insertContent({ type: 'image' });
    const markdown = docToMarkdown(editor.state.doc);
    editor.destroy();

    expect(markdown).toBe('![]()');
  });

  it('writes a GFM table', () => {
    const html =
      '<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr>' +
      '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>';
    expect(toMarkdown(html)).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('escapes a pipe inside a table cell', () => {
    const html = '<table><tbody><tr><th><p>a|b</p></th></tr></tbody></table>';
    expect(toMarkdown(html)).toBe('| a\\|b |\n| --- |');
  });

  it('flattens columns, which markdown has no syntax for', () => {
    const html =
      '<div class="ue-columns"><div class="ue-column"><p>左</p></div>' +
      '<div class="ue-column"><p>右</p></div></div>';
    // The layout is gone; both columns' prose is still there, in order.
    expect(toMarkdown(html)).toBe('左\n\n右');
  });

  it('escapes text that would otherwise read back as syntax', () => {
    expect(toMarkdown('<p>2 * 3 * 4</p>')).toBe('2 \\* 3 \\* 4');
    expect(toMarkdown('<p># 不是标题</p>')).toBe('\\# 不是标题');
    expect(toMarkdown('<p>- 不是列表</p>')).toBe('\\- 不是列表');
    expect(toMarkdown('<p>1. 不是有序列表</p>')).toBe('1\\. 不是有序列表');
  });

  it('writes a hard break as two trailing spaces', () => {
    expect(toMarkdown('<p>a<br>b</p>')).toBe('a  \nb');
  });

  it('drops a hard break that has no line to break', () => {
    // Markdown has no syntax for two breaks in a row: the second writes a line
    // holding only its own `  ` marker, and a blank line ends the paragraph. Kept,
    // it reads back as two paragraphs — a blank line the author never typed —
    // and shows in the source view as a line that looks empty but is not.
    expect(toMarkdown('<p>a<br><br>b</p>')).toBe('a  \nb');
    expect(toMarkdown('<p>a<br></p>')).toBe('a');
    expect(toMarkdown('<p><br>a</p>')).toBe('a');
    // A paragraph that is nothing but a break carries no text at all.
    expect(toMarkdown('<p>a</p><p><br></p><p>b</p>')).toBe('a\n\nb');
  });

  it('keeps a paragraph whole across a doubled break', () => {
    // The break is lost either way; the paragraph must not be.
    expect(markdownToHTML(toMarkdown('<p>a<br><br>b</p>'))).toBe('<p>a<br>b</p>');
  });

  it('folds a break inside a heading, which markdown can only write on one line', () => {
    // Spilled onto a second line the remainder comes back as a paragraph, so the
    // heading loses its level. A space costs the break and keeps the heading.
    expect(toMarkdown('<h2>标题<br>第二行</h2>')).toBe('## 标题 第二行');
    expect(toMarkdown('<h2><br><br>标题</h2>')).toBe('## 标题');
    expect(roundTrip('## 标题 第二行')).toBe('## 标题 第二行');
  });

  it('folds a break inside a table cell, marker and all', () => {
    // A cell is one line too. Left behind, the marker's two spaces show as a gap
    // that the next trip out would trim — so the source never settled.
    expect(toMarkdown('<table><tbody><tr><td><p>a<br>b</p></td></tr></tbody></table>')).toBe(
      '| a b |\n| --- |'
    );
  });

  it('drops empty paragraphs rather than emitting blank blocks', () => {
    expect(toMarkdown('<p>a</p><p></p><p>b</p>')).toBe('a\n\nb');
  });

  it('keeps a second paragraph in the list item it was written under', () => {
    const html = '<ul><li><p>一</p><p>续段</p></li><li><p>二</p></li></ul>';
    const markdown = '- 一\n\n  续段\n- 二';
    expect(toMarkdown(html)).toBe(markdown);
    // Read back as the end of the list, the continuation became a top-level
    // paragraph and split the list in two around itself — and each split wrote a
    // blank line of its own, so the source grew a line every way it was opened.
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('still lets an unindented paragraph end the list', () => {
    expect(roundTrip('- 一\n- 二\n\n段落')).toBe('- 一\n- 二\n\n段落');
  });

  it('ends the list at a trailing blank line, with nothing after it to continue', () => {
    expect(markdownToHTML('- 一\n')).toBe('<ul><li>一</li></ul>');
  });

  it('returns an empty string for an empty document', () => {
    expect(toMarkdown('')).toBe('');
  });
});

describe('document to markdown, beyond the shipped schema', () => {
  /** An inline node a host might add — a mention chip, an emoji, a footnote marker. */
  const Chip = TiptapNode.create({
    name: 'chip',
    group: 'inline',
    inline: true,
    atom: true,
    parseHTML: () => [{ tag: 'span.chip' }],
    renderHTML: () => ['span', { class: 'chip' }]
  });

  /** A block node a host might add — a callout, an embed, a divider of its own. */
  const Callout = TiptapNode.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    parseHTML: () => [{ tag: 'div.callout' }],
    renderHTML: () => ['div', { class: 'callout' }, 0]
  });

  /** A textblock a host might add — a figure caption, a lede, a pull quote. */
  const Lede = TiptapNode.create({
    name: 'lede',
    group: 'block',
    content: 'inline*',
    // Above paragraph's own `p` rule, which otherwise wins the tie and swallows it.
    parseHTML: () => [{ tag: 'p.lede', priority: 60 }],
    renderHTML: () => ['p', { class: 'lede' }, 0]
  });

  function toMarkdownWith(html: string): string {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      content: html,
      // Images inline rather than as blocks, plus two node types this serialiser
      // has never heard of — the shape a host with its own extensions ends up in.
      extensions: [
        ...createUltraKit({ features: { image: false } }),
        ImageFigure.configure({ inline: true, allowBase64: true }),
        Chip,
        Callout,
        Lede
      ]
    });
    const markdown = docToMarkdown(editor.state.doc);
    editor.destroy();
    return markdown;
  }

  it('writes an image that sits inline in a paragraph', () => {
    expect(toMarkdownWith('<p>前 <img src="/a.png" alt="图"> 后</p>')).toBe('前 ![图](/a.png) 后');
  });

  it('keeps the words around an inline node it has no syntax for', () => {
    expect(toMarkdownWith('<p>前 <span class="chip"></span> 后</p>')).toBe('前  后');
  });

  it('descends into a block node it does not know', () => {
    // Losing the callout's box is fine; losing the paragraph inside it is not.
    expect(toMarkdownWith('<div class="callout"><p>提示正文</p></div>')).toBe('提示正文');
  });

  it('writes the text of a textblock it does not know', () => {
    expect(toMarkdownWith('<p class="lede">导语</p>')).toBe('导语');
  });

  it('drops an unknown wrapper whose contents are empty', () => {
    expect(toMarkdownWith('<div class="callout"><p></p></div><p>正文</p>')).toBe('正文');
  });

  it('drops an unknown block that has nothing in it', () => {
    // An empty block contributes no Markdown; a blank line between blocks would
    // be all it produced, and the joiner writes that anyway.
    expect(toMarkdownWith('<p class="lede"></p><p>正文</p>')).toBe('正文');
  });
});

describe('markdown round trip', () => {
  it.each([
    ['headings', '# 一\n\n## 二'],
    ['paragraph with marks', '**粗** 与 *斜* 与 ~~删~~'],
    ['inline code', '用 `git status` 看一眼'],
    ['link', '见 [文档](https://example.com)'],
    ['bullet list', '- a\n- b'],
    ['ordered list', '1. a\n2. b'],
    ['nested list', '- a\n  - b'],
    ['blockquote', '> 引用'],
    ['code block', '```ts\nconst a = 1;\n```'],
    ['thematic break', '---'],
    ['table', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
    ['image', '![图](/a.png)'],
    ['hard break', 'a  \nb'],
    ['escaped syntax', '2 \\* 3']
  ])('survives a round trip: %s', (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it('survives a whole document', () => {
    const markdown = [
      '# 标题',
      '',
      '一段 **正文**，里面有 [链接](https://example.com) 和 `代码`。',
      '',
      '- 第一项',
      '- 第二项',
      '  - 嵌套',
      '',
      '> 引用',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '| 列 | 值 |',
      '| --- | --- |',
      '| a | 1 |'
    ].join('\n');

    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe('looksLikeMarkdown', () => {
  it.each([
    '# 标题',
    '- 列表',
    '1. 有序',
    '> 引用',
    '```\ncode\n```',
    '---',
    '| a |\n| --- |',
    '看 [这里](https://x.com) 的 **说明**'
  ])('recognises %j', (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    '',
    '   ',
    '就是一段普通的话。',
    'a * b = c',
    '价格是 5-10 元',
    'Hello, world!',
    '只有一个 **加粗** 不算'
  ])('leaves %j alone', (text) => {
    // Rewriting someone's prose because it happened to contain an asterisk is
    // worse than leaving a stray bit of Markdown untouched.
    expect(looksLikeMarkdown(text)).toBe(false);
  });

  // Two inline signals are needed for a `true`, so each of these pairs an
  // emphasis run with a code span to isolate what the emphasis check itself says.
  it.each([
    ['**粗** 和 `code`', true],
    ['~~删~~ 和 `code`', true],
    ['**a*** 和 `code`', true],
    ['** 开头是空格** 和 `code`', false],
    ['**结尾是空格 ** 和 `code`', false],
    ['**** 和 `code`', false],
    ['开着的 **加粗 和 `code`', false],
    ['**跨\n行** 和 `code`', true]
  ])('reads the emphasis in %j as %s', (text, expected) => {
    expect(looksLikeMarkdown(text)).toBe(expected);
  });

  it('answers in linear time for a paste full of unpaired emphasis', () => {
    // `**kwargs` in pasted Python, `~~` used as a wave dash in Chinese: openers
    // with no closer. The lazy regexes this replaced ran to the end of the input
    // and backtracked once per opener, which took 2.7 s on this exact string.
    const text = 'lorem ipsum dolor sit amet **consectetur ~~adipiscing elit. '.repeat(16_000);

    const started = performance.now();
    const result = looksLikeMarkdown(text);
    const elapsed = performance.now() - started;

    expect(result).toBe(false);
    // Measured at ~1 ms. The bound is loose on purpose — this is here to catch a
    // return to quadratic scanning, not to police milliseconds on a busy machine.
    expect(elapsed).toBeLessThan(150);
  });
});
