import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * ProseMirror document → Markdown.
 *
 * Deliberately not `prosemirror-markdown`: that package serialises *its own*
 * schema, and this one has tables, figures and columns it has never heard of.
 * A converter written against the schema we actually ship is both smaller and
 * lossless for the nodes we care about.
 *
 * Anything Markdown cannot express degrades rather than disappears — a column
 * row becomes its columns' blocks in order, an underline becomes plain text.
 * Losing the layout is acceptable; losing the words is not.
 */

/**
 * Characters that would otherwise be read back as syntax.
 *
 * `~` earns its place twice over: a bare `~~x~~` comes back as a strikethrough
 * nobody applied, and a paragraph of `~~~` opens a fenced code block that eats
 * the rest of the document on the way in.
 */
const INLINE_ESCAPE = /([\\`*_[\]~])/g;

/** Markdown that only bites at the start of a line. */
const LEADING_SYMBOL = /^(\s*)([#>+\-|])/;
const LEADING_NUMBER = /^(\s*)(\d+)([.)])/;

function escapeInline(text: string): string {
  return text.replace(INLINE_ESCAPE, '\\$1');
}

/**
 * Neutralise a marker that only carries meaning at the start of a line.
 *
 * For a numbered marker the backslash goes before the *punctuation*: `\1.` is not
 * a valid escape — Markdown only lets punctuation be escaped — so a reader hands
 * the backslash back as literal text and the author sees one they never typed.
 * `1\.` is the form that survives the trip.
 */
function escapeLeading(line: string): string {
  return line.replace(LEADING_SYMBOL, '$1\\$2').replace(LEADING_NUMBER, '$1$2\\$3');
}

/**
 * A link destination in the form the parser reads back as the same URL.
 *
 * A bare destination carries no whitespace, and carries parentheses only while
 * they pair up — written bare, `https://x.com/a b` and `https://x.com/a(b` both
 * read back as literal text and the link is gone, while `https://x.com/a)b`
 * comes back truncated with its tail loose in the paragraph. `<...>` is the
 * escape hatch for all three.
 *
 * The depth ceiling mirrors the parser's: it reads two levels of nesting, so
 * anything deeper has to be wrapped for the round trip to hold.
 */
function destination(url: string): string {
  let depth = 0;
  let deepest = 0;
  let unbalanced = false;
  for (const char of url) {
    if (char === '(') deepest = Math.max(deepest, ++depth);
    else if (char === ')' && --depth < 0) unbalanced = true;
  }
  const bareSurvives = !/\s/.test(url) && !unbalanced && depth === 0 && deepest <= 2;
  // An angle-wrapped destination cannot carry an angle bracket of its own, and
  // the parser reads no escapes inside one — such a URL has no form that round
  // trips, so it goes out bare rather than wrapped into something worse.
  return bareSurvives || /[<>]/.test(url) ? url : `<${url}>`;
}

/**
 * Wrap text in one mark's delimiters.
 *
 * `code` is terminal: Markdown has no way to bold the inside of a code span, so
 * whatever else the text carries is dropped rather than emitted as literal
 * asterisks the reader would see inside the backticks.
 */
function applyMark(mark: Mark, text: string): string {
  switch (mark.type.name) {
    case 'bold':
      return `**${text}**`;
    case 'italic':
      return `*${text}*`;
    case 'strike':
      return `~~${text}~~`;
    case 'link': {
      // A link mark without an href is a link to nowhere; `[text]()` would only
      // read back as broken syntax, so the text goes out on its own.
      const href = mark.attrs.href as string | null;
      return href ? `[${text}](${destination(href)})` : text;
    }
    default:
      // underline, textStyle (colour), and anything a host added: Markdown has no
      // syntax for them, so the text survives and the styling does not.
      return text;
  }
}

/** A code span, with enough backticks to survive backticks in the content. */
function codeSpan(text: string): string {
  let fence = '`';
  while (text.includes(fence)) fence += '`';
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function serializeInline(node: ProseMirrorNode): string {
  let out = '';

  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      // Two trailing spaces is the only line break GFM honours inside a paragraph.
      out += '  \n';
      return;
    }
    if (child.type.name === 'image') {
      out += imageMarkdown(child);
      return;
    }
    if (!child.isText) {
      out += serializeInline(child);
      return;
    }

    // A ProseMirror text node always carries text; the `??` is for the type.
    /* v8 ignore next */
    const text = child.text ?? '';
    if (child.marks.some((mark) => mark.type.name === 'code')) {
      out += codeSpan(text);
      return;
    }

    // Inner marks first, so `**[link](x)**` nests the way Markdown reads it.
    out += child.marks.reduce<string>((acc, mark) => applyMark(mark, acc), escapeInline(text));
  });

  return out;
}

function imageMarkdown(node: ProseMirrorNode): string {
  // The caption is what the reader sees under the image, so it outranks `alt`
  // as the description to carry across; either may legitimately be absent.
  const src = (node.attrs.src as string | null) ?? '';
  const alt = ((node.attrs.caption ?? node.attrs.alt) as string | null) ?? '';
  const title = node.attrs.title as string | null;
  return `![${escapeInline(alt)}](${destination(src)}${title ? ` "${title}"` : ''})`;
}

/**
 * Flatten a textblock onto one line.
 *
 * For the places Markdown gives a line break nowhere to land — an ATX heading, a
 * table cell. The break marker goes with the newline: leaving its two spaces
 * behind would show as a gap the author never typed, and on the next trip out
 * they would be trimmed anyway, so the source never settled.
 */
function foldBreaks(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

function prefixLines(text: string, first: string, rest = first): string {
  return text
    .split('\n')
    .map((line, index) => {
      const prefix = index === 0 ? first : rest;
      // Trailing whitespace on an otherwise blank continuation line is noise that
      // some renderers turn into a stray hard break.
      return line ? prefix + line : prefix.trimEnd();
    })
    .join('\n');
}

/** One table row as a GFM pipe row. Cells cannot hold blocks, so they flatten. */
function tableRow(row: ProseMirrorNode): string[] {
  const cells: string[] = [];
  row.forEach((cell) => {
    const parts: string[] = [];
    cell.forEach((block) => parts.push(serializeInline(block)));
    cells.push(foldBreaks(parts.join(' ').replace(/\|/g, '\\|')));
  });
  return cells;
}

function serializeTable(node: ProseMirrorNode): string {
  const rows: string[][] = [];
  node.forEach((row) => rows.push(tableRow(row)));
  // The schema puts `tableRow+` in a table, so an empty one cannot be built.
  /* v8 ignore next */
  if (!rows.length) return '';

  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => Array.from({ length: width }, (_unused, i) => row[i] ?? '');

  // GFM has no headerless table. A table whose first row is plain cells still
  // needs a header line, so the first row is promoted into it.
  const [header, ...body] = rows;
  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map((row) => `| ${pad(row).join(' | ')} |`)
  ];
  return lines.join('\n');
}

/**
 * One list item's contents.
 *
 * Blocks are separated by a blank line as usual, except for a nested list, which
 * hangs directly off its parent's line — a blank line there makes the list
 * *loose*, and a loose item comes back as a paragraph inside the `<li>` rather
 * than as the bare text it started out as.
 */
function serializeListItem(item: ProseMirrorNode, depth: number): string {
  let out = '';
  item.forEach((child) => {
    const block = serializeBlock(child, depth);
    if (block === null) return;
    const nested = child.type.name === 'bulletList' || child.type.name === 'orderedList';
    out = out ? `${out}${nested ? '\n' : '\n\n'}${block}` : block;
  });
  return out;
}

function serializeList(node: ProseMirrorNode, ordered: boolean, depth: number): string {
  const start = (node.attrs.start as number | undefined) ?? 1;
  const items: string[] = [];
  node.forEach((item, _offset, index) => {
    const bullet = ordered ? `${start + index}. ` : '- ';
    // Continuation lines line up under the text, which is what keeps a nested
    // list attached to its parent item instead of starting a list of its own.
    items.push(prefixLines(serializeListItem(item, depth + 1), bullet, ' '.repeat(bullet.length)));
  });
  return items.join('\n');
}

/** Serialise a node's children as consecutive blocks. */
function serializeBlocks(parent: ProseMirrorNode, depth: number): string {
  const blocks: string[] = [];
  parent.forEach((child) => {
    const block = serializeBlock(child, depth);
    if (block !== null) blocks.push(block);
  });
  return blocks.join('\n\n');
}

function serializeBlock(node: ProseMirrorNode, depth: number): string | null {
  switch (node.type.name) {
    case 'paragraph': {
      // A hard break with no text after it writes `  ` and nothing else, and a
      // blank line is precisely how Markdown ends a paragraph — read back, such a
      // line splits the paragraph in two instead of continuing it, which is the
      // blank line the author never typed. Markdown cannot hold two breaks in a
      // row, so dropping the empty one loses the smaller half: one line break
      // rather than the paragraph itself.
      const lines = serializeInline(node)
        .split('\n')
        .filter((line) => line.trim());
      // `trimEnd` is for a break that trailed the paragraph: its two spaces have
      // nothing left to break away from, and some renderers read them as one.
      const text = lines.map(escapeLeading).join('\n').trimEnd();
      // An empty paragraph carries no Markdown of its own; the blank line between
      // blocks already says everything it would have.
      return text || null;
    }

    case 'heading': {
      // The attribute has a schema default, so it is always a number here; the
      // clamp is what keeps a host's extra level from emitting `####### `.
      /* v8 ignore next */
      const level = Math.min(6, Math.max(1, (node.attrs.level as number | undefined) ?? 1));
      // An ATX heading is one line by definition, so a hard break inside one has
      // nowhere to go. Written out, the rest of the heading lands on a line of its
      // own and reads back as a paragraph — the words survive but the heading does
      // not. Folding the break into a space keeps both.
      return `${'#'.repeat(level)} ${foldBreaks(serializeInline(node))}`;
    }

    case 'codeBlock': {
      const language = (node.attrs.language as string | null) ?? '';
      // Read once: `textContent` is a getter that rebuilds the string from the
      // node's children on every access, and this used it as a loop condition.
      const code = node.textContent;
      // Long enough to not be closed by backticks inside the code.
      let fence = '```';
      while (code.includes(fence)) fence += '`';
      return `${fence}${language}\n${code}\n${fence}`;
    }

    case 'blockquote':
      return prefixLines(serializeBlocks(node, depth), '> ');

    case 'bulletList':
      return serializeList(node, false, depth);

    case 'orderedList':
      return serializeList(node, true, depth);

    case 'horizontalRule':
      return '---';

    case 'image':
      return imageMarkdown(node);

    case 'table':
      return serializeTable(node);

    // Markdown has no multi-column layout. Flattening keeps the prose, in order.
    // A column holds `block+`, so the empty arm is for the type, not for a case
    // the schema can produce.
    case 'columnBlock':
    case 'column':
      /* v8 ignore next */
      return serializeBlocks(node, depth) || null;

    // Whatever a host added. Losing the wrapper is fine; losing its words is not.
    default:
      return node.isTextblock
        ? serializeInline(node) || null
        : serializeBlocks(node, depth) || null;
  }
}

/** Serialise a whole ProseMirror document to Markdown. */
export function docToMarkdown(doc: ProseMirrorNode): string {
  return serializeBlocks(doc, 0)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
