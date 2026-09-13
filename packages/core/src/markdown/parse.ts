import { isSafeImageUrl, isSafeLinkUrl } from '../utils/url';

/**
 * Markdown → HTML.
 *
 * HTML rather than ProseMirror nodes on purpose: the editor already knows how to
 * parse HTML into its own schema — including the figure/caption handling, the
 * table shape and the `language-` class on code blocks — so producing HTML reuses
 * all of it instead of duplicating that mapping in a second place. It also means
 * a host can hand the result straight to `setContent`.
 *
 * The dialect is CommonMark's common half plus GFM tables and strikethrough:
 * the subset this editor's schema can actually hold. Raw HTML in the source is
 * escaped rather than passed through — Markdown arriving from a paste buffer is
 * untrusted input, and the document's own sanitisers only cover what the schema
 * lets in.
 */

const escapeHTML = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Sentinel for parked HTML. A private-use code point, so it cannot collide with
 * anything a human typed — and it is stripped from the input before parsing, so
 * a crafted document cannot forge a placeholder and smuggle HTML past the escape.
 */
const MARK = '\uE000';
const PLACEHOLDER = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');

class Frozen {
  private readonly parts: string[] = [];

  /** Park finished HTML so no later rule can match inside it. */
  add(html: string): string {
    this.parts.push(html);
    return `${MARK}${this.parts.length - 1}${MARK}`;
  }

  /** Put the parked HTML back. Recursive: a link's HTML holds its label's. */
  resolve(text: string): string {
    return text.replace(PLACEHOLDER, (_match, index: string) =>
      this.resolve(this.parts[Number(index)])
    );
  }
}

const BACKSLASH_ESCAPE = /\\([\\`*_{}[\]()#+\-.!>~|])/g;
const CODE_SPAN = /(?<!\\)(`+)([^`]|[\s\S]*?[^`])\1(?!`)/g;
/**
 * A bare link destination.
 *
 * CommonMark allows parentheses in one as long as they pair up, which is the
 * only reason `.../Ruby_(programming_language)` survives being written down.
 * Ending at the first `)` instead truncates the URL and spills its tail into the
 * paragraph. Backslash-escaped parens never reach here — `BACKSLASH_ESCAPE` has
 * already parked them as placeholders by the time links are scanned.
 *
 * Two levels of nesting, not arbitrary depth: a regex cannot count, and no real
 * URL nests deeper. Anything past that ends at the first unpaired `)`, exactly
 * as it does today. The two alternatives start on different characters, so the
 * engine never has a choice to backtrack over.
 */
const CHAR = String.raw`[^\s()]`;
const NESTED = String.raw`\((?:${CHAR}|\(${CHAR}*\))*\)`;
const DEST = String.raw`(?:${CHAR}|${NESTED})*`;
const TAIL = String.raw`(?:\s+"([^"]*)")?\s*\)`;

const IMAGE = new RegExp(String.raw`!\[([^\]]*)\]\(\s*(<[^>]*>|${DEST})${TAIL}`, 'g');
const LINK = new RegExp(String.raw`\[([^\]]*)\]\(\s*(<[^>]*>|${DEST})${TAIL}`, 'g');

/** `<...>` is the escape hatch for a URL containing spaces or parentheses. */
const bareUrl = (url: string) =>
  url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url;

/**
 * Emphasis, strikethrough and hard breaks, over text that is already HTML-escaped
 * and may hold placeholders. Split out because a link label needs exactly this
 * and must not be run through the whole inline pass again — its code spans and
 * escapes are already parked, and re-escaping would show the reader `&lt;code&gt;`.
 */
function emphasize(escaped: string): string {
  return (
    escaped
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>')
      // Longest delimiter first. Left to the `**` and `*` rules in sequence,
      // `***both***` closes the outer tag before the inner one and emits
      // overlapping markup that no HTML parser will read back the way it looks.
      .replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '<em><strong>$2</strong></em>')
      .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
      .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '<em>$1</em>')
      // A lone `_` only opens emphasis at a word boundary, so `snake_case_name`
      // stays a word rather than becoming italics with a stray underscore.
      .replace(/\b_(?=\S)([\s\S]*?\S)_\b/g, '<em>$1</em>')
      // Two trailing spaces: GFM's hard break.
      .replace(/ {2,}\n/g, '<br>')
  );
}

/**
 * Inline Markdown → HTML.
 *
 * Order is the whole game. Code spans bind tightest and take their content
 * verbatim, then escapes, then images and links — whose URLs must not be rescanned
 * for emphasis — and only then the emphasis run.
 */
export function inlineToHTML(source: string): string {
  const frozen = new Frozen();
  let text = source.split(MARK).join('');

  text = text.replace(CODE_SPAN, (_match, _fence: string, body: string) => {
    // One space of padding either side is a delimiter, not content — it is what
    // lets a code span hold a literal backtick.
    const inner =
      body.length > 2 && body.startsWith(' ') && body.endsWith(' ') ? body.slice(1, -1) : body;
    return frozen.add(`<code>${escapeHTML(inner)}</code>`);
  });

  text = text.replace(BACKSLASH_ESCAPE, (_match, char: string) => frozen.add(escapeHTML(char)));

  text = text.replace(IMAGE, (match, alt: string, src: string, title: string | undefined) => {
    const url = bareUrl(src);
    if (!url || !isSafeImageUrl(url)) return frozen.add(escapeHTML(match));
    const attrs = [`src="${escapeHTML(url)}"`];
    if (alt) attrs.push(`alt="${escapeHTML(alt)}"`);
    if (title) attrs.push(`title="${escapeHTML(title)}"`);
    return frozen.add(`<img ${attrs.join(' ')}>`);
  });

  text = text.replace(LINK, (match, label: string, href: string, title: string | undefined) => {
    const url = bareUrl(href);
    if (!url || !isSafeLinkUrl(url)) return frozen.add(escapeHTML(match));
    const attrs = [`href="${escapeHTML(url)}"`];
    if (title) attrs.push(`title="${escapeHTML(title)}"`);
    return frozen.add(`<a ${attrs.join(' ')}>${emphasize(escapeHTML(label))}</a>`);
  });

  return frozen.resolve(emphasize(escapeHTML(text)));
}

/* Block level ---------------------------------------------------------------- */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BLOCKQUOTE = /^ {0,3}> ?(.*)$/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*\|?\s*$/;

const isBlank = (line: string) => !line.trim();

/**
 * Does this line open a block of its own, ending the lazy continuation of the
 * quote above it?
 *
 * An ordered list only counts when it starts at 1, per CommonMark — otherwise a
 * sentence that happens to wrap onto `2. ` would be cut in half.
 *
 * Thematic breaks are deliberately absent. `---` directly under a line of text is
 * a setext heading underline, which this parser does not implement; breaking the
 * quote there would swap one wrong reading for another rather than fix anything.
 */
function endsLazyQuote(line: string): boolean {
  return isBlank(line) || HEADING.test(line) || FENCE.test(line) || canInterruptParagraph(line);
}

function canInterruptParagraph(line: string): boolean {
  if (BULLET.test(line)) return true;
  const ordered = ORDERED.exec(line);
  return ordered !== null && ordered[2] === '1';
}

/** Split a pipe-table row, honouring `\|` inside a cell. */
function tableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] === '\\' && trimmed[index + 1] === '|') {
      cell += '|';
      index++;
      continue;
    }
    if (trimmed[index] === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += trimmed[index];
  }
  cells.push(cell.trim());
  return cells;
}

/** Depth of a list marker, in nesting levels rather than columns. */
const indentOf = (spaces: string) => Math.floor(spaces.replace(/\t/g, '    ').length / 2);

interface ListItem {
  level: number;
  ordered: boolean;
  lines: string[];
}

/** Render one run of same-level items, recursing into anything indented deeper. */
function renderList(items: ListItem[], from: number): { html: string; next: number } {
  const { level, ordered } = items[from];
  const parts: string[] = [];
  let index = from;

  while (index < items.length && items[index].level === level && items[index].ordered === ordered) {
    let body = blocksToHTML(items[index].lines, true);
    index += 1;
    if (index < items.length && items[index].level > level) {
      const nested = renderList(items, index);
      body += nested.html;
      index = nested.next;
    }
    parts.push(`<li>${body}</li>`);
  }

  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${parts.join('')}</${tag}>`, next: index };
}

/**
 * A run of lines → HTML.
 *
 * `tight` is the list-item case: the item's first paragraph is emitted bare, so
 * `<li>` holds text rather than a nested `<p>` — which is what ProseMirror's
 * listItem expects when it parses this back.
 */
function blocksToHTML(lines: string[], tight = false): string {
  const html: string[] = [];
  let buffer: string[] = [];
  let index = 0;

  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (!text) return;
    const inner = inlineToHTML(text);
    html.push(tight && !html.length ? inner : `<p>${inner}</p>`);
  };

  while (index < lines.length) {
    const line = lines[index];

    if (isBlank(line)) {
      flush();
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const closing = new RegExp(
        `^\\s{0,3}${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`
      );
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // the closing fence, or one past the end for an unterminated block
      const language = fence[2] ? ` class="language-${escapeHTML(fence[2])}"` : '';
      html.push(`<pre><code${language}>${escapeHTML(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineToHTML(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (HR.test(line)) {
      flush();
      html.push('<hr>');
      index += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      flush();
      const body: string[] = [];
      while (index < lines.length) {
        const quoted = BLOCKQUOTE.exec(lines[index]);
        if (quoted) {
          body.push(quoted[1]);
          index += 1;
          continue;
        }
        // A plain line under a quote is a lazy continuation of it; a blank line or
        // a block of its own ends the quote.
        if (endsLazyQuote(lines[index])) break;
        body.push(lines[index]);
        index += 1;
      }
      html.push(`<blockquote>${blocksToHTML(body)}</blockquote>`);
      continue;
    }

    // A pipe table is only a table if its divider is on the very next line.
    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      flush();
      const header = tableCells(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && !isBlank(lines[index]) && lines[index].includes('|')) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      const cell = (tag: string, value: string) => `<${tag}><p>${inlineToHTML(value)}</p></${tag}>`;
      const head = `<tr>${header.map((value) => cell('th', value)).join('')}</tr>`;
      const body = rows
        .map((row) => {
          const filled = Array.from({ length: header.length }, (_unused, i) => row[i] ?? '');
          return `<tr>${filled.map((value) => cell('td', value)).join('')}</tr>`;
        })
        .join('');
      html.push(`<table><tbody>${head}${body}</tbody></table>`);
      continue;
    }

    if (
      (BULLET.test(line) || ORDERED.test(line)) &&
      (!buffer.length || canInterruptParagraph(line))
    ) {
      flush();
      const items: ListItem[] = [];
      while (index < lines.length) {
        const bullet = BULLET.exec(lines[index]);
        const ordered = bullet ? null : ORDERED.exec(lines[index]);
        const match = bullet ?? ordered;
        if (match) {
          const level = indentOf(match[1]);
          const previous = items[items.length - 1];
          // A marker indented past the item above it opens a nested list, and may
          // only do so when it could interrupt the paragraph that item is in the
          // middle of. An ordered marker that does not start at 1 cannot, so it
          // stays part of the sentence instead of eating its own number.
          const opensNested = previous !== undefined && level > previous.level;
          if (!opensNested || canInterruptParagraph(lines[index])) {
            items.push({ level, ordered: !bullet, lines: [match[3]] });
            index += 1;
            continue;
          }
        }
        // An indented line under an item is a continuation of it.
        if (!isBlank(lines[index]) && /^\s{2,}/.test(lines[index])) {
          items[items.length - 1].lines.push(lines[index].trim());
          index += 1;
          continue;
        }
        // A blank line followed by an indented line is the *inside* of a loose
        // item — the separator between two blocks of the same bullet — not the
        // end of the list. Breaking here is what let a second paragraph escape
        // its item and become a top-level block, splitting the list around it
        // and growing a blank line either side on the way back out.
        if (isBlank(lines[index]) && /^\s{2,}\S/.test(lines[index + 1] ?? '')) {
          items[items.length - 1].lines.push('');
          index += 1;
          continue;
        }
        break;
      }
      // `renderList` renders one homogeneous run and reports where it stopped —
      // it gives up at the first item whose level or marker type differs. Draining
      // the rest is what keeps a bullet list followed straight by an ordered one,
      // with no blank line between them, from losing every item after the switch.
      for (let cursor = 0; cursor < items.length; ) {
        const run = renderList(items, cursor);
        html.push(run.html);
        cursor = run.next;
      }
      continue;
    }

    buffer.push(line);
    index += 1;
  }

  flush();
  return html.join('');
}

/**
 * Convert a Markdown document to HTML the editor can parse.
 *
 * Feed the result to `setContent`, or to a paste handler — the schema's own parse
 * rules take it from there.
 */
export function markdownToHTML(markdown: string): string {
  return blocksToHTML(markdown.replace(/\r\n?/g, '\n').split('\n'));
}
