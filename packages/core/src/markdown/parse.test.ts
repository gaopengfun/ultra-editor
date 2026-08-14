import { describe, expect, it } from 'vitest';
import { inlineToHTML, markdownToHTML } from './parse';

/** The parser's private-use sentinel for parked HTML, spelled out. */
const MARK = '\uE000';

describe('inline markdown', () => {
  it('marks up emphasis, strong and strikethrough', () => {
    expect(inlineToHTML('*a* **b** ~~c~~')).toBe('<em>a</em> <strong>b</strong> <s>c</s>');
    expect(inlineToHTML('__b__ _i_')).toBe('<strong>b</strong> <em>i</em>');
  });

  it('reads a double delimiter as strong, not nested emphasis', () => {
    expect(inlineToHTML('**bold**')).toBe('<strong>bold</strong>');
    expect(inlineToHTML('***both***')).toBe('<em><strong>both</strong></em>');
  });

  it('leaves underscores inside a word alone', () => {
    // `snake_case_name` is an identifier, not italics with a stray underscore.
    expect(inlineToHTML('snake_case_name')).toBe('snake_case_name');
  });

  it('takes code spans verbatim and lets them hold backticks', () => {
    expect(inlineToHTML('`a * b`')).toBe('<code>a * b</code>');
    expect(inlineToHTML('`` ` ``')).toBe('<code>`</code>');
    // Nothing inside a code span is syntax — including what looks like a link.
    expect(inlineToHTML('`[a](b)`')).toBe('<code>[a](b)</code>');
  });

  it('honours backslash escapes', () => {
    expect(inlineToHTML('\\*not italic\\*')).toBe('*not italic*');
    expect(inlineToHTML('\\`not code\\`')).toBe('`not code`');
    expect(inlineToHTML('a \\\\ b')).toBe('a \\ b');
  });

  it('builds links and images, and lets a label carry emphasis', () => {
    expect(inlineToHTML('[a](https://x.com)')).toBe('<a href="https://x.com">a</a>');
    expect(inlineToHTML('[**a**](https://x.com)')).toBe(
      '<a href="https://x.com"><strong>a</strong></a>'
    );
    expect(inlineToHTML('![alt](/a.png)')).toBe('<img src="/a.png" alt="alt">');
    expect(inlineToHTML('![](/a.png)')).toBe('<img src="/a.png">');
    expect(inlineToHTML('![a](/a.png "t")')).toBe('<img src="/a.png" alt="a" title="t">');
    expect(inlineToHTML('[a](https://x.com "t")')).toBe('<a href="https://x.com" title="t">a</a>');
  });

  it('accepts an angle-bracketed URL with spaces in it', () => {
    expect(inlineToHTML('[a](<https://x.com/a b>)')).toBe('<a href="https://x.com/a b">a</a>');
  });

  it('leaves a link whose text is a code span intact', () => {
    expect(inlineToHTML('[`x`](https://x.com)')).toBe('<a href="https://x.com"><code>x</code></a>');
  });

  it('turns two trailing spaces into a hard break', () => {
    expect(inlineToHTML('a  \nb')).toBe('a<br>b');
  });
});

describe('inline markdown safety', () => {
  it('escapes raw HTML rather than passing it through', () => {
    expect(inlineToHTML('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(inlineToHTML('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('refuses a javascript: link and leaves the source text visible', () => {
    expect(inlineToHTML('[click](javascript:alert(1))')).toBe('[click](javascript:alert(1))');
    expect(inlineToHTML('![x](javascript:alert(1))')).toBe('![x](javascript:alert(1))');
  });

  it('refuses a data: image that is not an image', () => {
    expect(inlineToHTML('![x](data:text/html,<script>)')).toContain('data:text/html');
    expect(inlineToHTML('![x](data:text/html,<script>)')).not.toContain('<img');
    expect(inlineToHTML('![x](data:image/png;base64,AAA)')).toBe(
      '<img src="data:image/png;base64,AAA" alt="x">'
    );
  });

  it('escapes quotes so an attribute cannot be broken out of', () => {
    expect(inlineToHTML('[a](https://x.com/")')).toBe('<a href="https://x.com/&quot;">a</a>');
    expect(inlineToHTML('![a"b](/x.png)')).toBe('<img src="/x.png" alt="a&quot;b">');
  });

  it('cannot be tricked by a forged placeholder in the source', () => {
    // The parser parks finished HTML behind a private-use sentinel; a document
    // carrying that sentinel must not be able to name someone else's HTML.
    const forged = MARK + '0' + MARK + ' and `real`';
    const html = inlineToHTML(forged);

    // The sentinel is stripped, so index 0 stays the digit the author typed and
    // the only parked HTML is the code span this pass created itself.
    expect(html).toBe('0 and <code>real</code>');
    expect(html).not.toContain(MARK);
  });
});

describe('block markdown', () => {
  it('converts headings at every level', () => {
    expect(markdownToHTML('# a\n\n###### f')).toBe('<h1>a</h1><h6>f</h6>');
    expect(markdownToHTML('## closed ##')).toBe('<h2>closed</h2>');
  });

  it('converts paragraphs and joins their wrapped lines', () => {
    expect(markdownToHTML('one\ntwo\n\nthree')).toBe('<p>one\ntwo</p><p>three</p>');
  });

  it('converts a fenced code block with its language', () => {
    expect(markdownToHTML('```ts\nconst a = 1;\n```')).toBe(
      '<pre><code class="language-ts">const a = 1;</code></pre>'
    );
    expect(markdownToHTML('```\nplain\n```')).toBe('<pre><code>plain</code></pre>');
    expect(markdownToHTML('~~~py\nx = 1\n~~~')).toBe(
      '<pre><code class="language-py">x = 1</code></pre>'
    );
  });

  it('keeps markdown inside a code block as text', () => {
    expect(markdownToHTML('```\n# not a heading\n**not bold**\n```')).toBe(
      '<pre><code># not a heading\n**not bold**</code></pre>'
    );
  });

  it('closes an unterminated fence at the end of the document', () => {
    expect(markdownToHTML('```\na')).toBe('<pre><code>a</code></pre>');
  });

  it('lets a longer fence hold a shorter one', () => {
    expect(markdownToHTML('````\n```\n````')).toBe('<pre><code>```</code></pre>');
  });

  it('converts blockquotes, including lazy continuation lines', () => {
    expect(markdownToHTML('> a\n> b')).toBe('<blockquote><p>a\nb</p></blockquote>');
    expect(markdownToHTML('> a\nb')).toBe('<blockquote><p>a\nb</p></blockquote>');
    expect(markdownToHTML('> a\n\nb')).toBe('<blockquote><p>a</p></blockquote><p>b</p>');
  });

  it('ends a quote at a line that opens a block of its own', () => {
    expect(markdownToHTML('> a\n# H')).toBe('<blockquote><p>a</p></blockquote><h1>H</h1>');
    expect(markdownToHTML('> a\n- b')).toBe('<blockquote><p>a</p></blockquote><ul><li>b</li></ul>');
    expect(markdownToHTML('> a\n1. b')).toBe(
      '<blockquote><p>a</p></blockquote><ol><li>b</li></ol>'
    );
    expect(markdownToHTML('> a\n```\nc\n```')).toBe(
      '<blockquote><p>a</p></blockquote><pre><code>c</code></pre>'
    );
  });

  it('keeps an ordered marker that does not start at 1 inside the quote', () => {
    // CommonMark only lets a list interrupt a paragraph when it starts at 1, so
    // `2.` does not end the quote the way `1.` does — a sentence wrapping onto
    // "2. " is not torn out of it. It still opens a list once the quote's own body
    // is parsed: paragraph interruption *within* a block is a separate rule this
    // parser does not implement.
    expect(markdownToHTML('> a\n2. b')).toBe(
      '<blockquote><p>a</p><ol><li>b</li></ol></blockquote>'
    );
  });

  it('converts thematic breaks', () => {
    expect(markdownToHTML('---')).toBe('<hr>');
    expect(markdownToHTML('***')).toBe('<hr>');
    expect(markdownToHTML('- - -')).toBe('<hr>');
  });

  it('converts bullet and ordered lists', () => {
    expect(markdownToHTML('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(markdownToHTML('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(markdownToHTML('* a\n+ b')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('nests a list under the item it is indented beneath', () => {
    expect(markdownToHTML('- a\n  - b\n- c')).toBe(
      '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>'
    );
  });

  it('takes an indented line as a continuation of the item above it', () => {
    expect(markdownToHTML('- 第一行\n  接着写\n- 第二项')).toBe(
      '<ul><li>第一行\n接着写</li><li>第二项</li></ul>'
    );
  });

  it('switches list type when the marker changes', () => {
    expect(markdownToHTML('- a\n\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
  });

  it('keeps every item when the marker changes with no blank line between', () => {
    // Hand-written and model-written Markdown runs the two lists together. Each
    // run is its own list, and none of them may go missing.
    expect(markdownToHTML('- a\n1. b')).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
    expect(markdownToHTML('1. one\n- two')).toBe('<ol><li>one</li></ol><ul><li>two</li></ul>');
    expect(markdownToHTML('- a\n1. b\n- c')).toBe(
      '<ul><li>a</li></ul><ol><li>b</li></ol><ul><li>c</li></ul>'
    );
  });

  it('keeps an item that dedents below the level the run started at', () => {
    expect(markdownToHTML('  - deep\n- shallow')).toBe(
      '<ul><li>deep</li></ul><ul><li>shallow</li></ul>'
    );
  });

  it('converts a GFM table', () => {
    const md = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(markdownToHTML(md)).toBe(
      '<table><tbody><tr><th><p>a</p></th><th><p>b</p></th></tr>' +
        '<tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>'
    );
  });

  it('pads a short table row out to the header width', () => {
    expect(markdownToHTML('| a | b |\n| --- | --- |\n| 1 |')).toContain(
      '<tr><td><p>1</p></td><td><p></p></td></tr>'
    );
  });

  it('keeps an escaped pipe inside a table cell', () => {
    expect(markdownToHTML('| a |\n| --- |\n| x \\| y |')).toContain('<p>x | y</p>');
  });

  it('leaves a pipe line alone without a divider under it', () => {
    expect(markdownToHTML('| a | b |')).toBe('<p>| a | b |</p>');
  });

  it('normalises CRLF line endings', () => {
    expect(markdownToHTML('# a\r\n\r\nb')).toBe('<h1>a</h1><p>b</p>');
  });

  it('returns nothing for an empty document', () => {
    expect(markdownToHTML('')).toBe('');
    expect(markdownToHTML('   \n  \n')).toBe('');
  });
});
