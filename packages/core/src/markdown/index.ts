export { docToMarkdown } from './serialize';
export { markdownToHTML, inlineToHTML } from './parse';

/** Block-level syntax: one of these is enough to call a string Markdown. */
const BLOCK_SIGNALS = [
  /^ {0,3}#{1,6}\s+\S/m, // heading
  /^ {0,3}(?:```|~~~)/m, // fenced code
  /^ {0,3}>\s/m, // blockquote
  /^ {0,3}[-*+]\s+\S/m, // bullet list
  /^ {0,3}\d{1,9}[.)]\s+\S/m, // ordered list
  /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/m, // thematic break
  /^\s*\|?(\s*:?-+:?\s*\|)+/m // table divider
];

/**
 * Is there a `**…**` (or `~~…~~`) pair anywhere — an opener with a non-space
 * after it, and a later closer with a non-space before it?
 *
 * Written out rather than left to a lazy `\*\*(?=\S)[\s\S]*?\S\*\*` regex, which
 * is quadratic on the input: every opener with no closer sends the lazy
 * quantifier to the end of the text and back. A 900 KB paste carrying 16k
 * unpaired `**` — Python's `**kwargs`, a wall of logs — took 2.7 s to answer a
 * question that is only a heuristic. This scans once, in about a millisecond.
 *
 * One scan is enough because a later opener can only reach a subset of the
 * closers an earlier one could: if the first opener finds none, none exist.
 */
function hasDelimitedPair(text: string, delimiter: string): boolean {
  const width = delimiter.length;

  let open = -1;
  for (let at = text.indexOf(delimiter); at !== -1; at = text.indexOf(delimiter, at + 1)) {
    const after = text[at + width];
    if (after && !/\s/.test(after)) {
      open = at;
      break;
    }
  }
  if (open === -1) return false;

  // The content has to be at least one character, so the earliest a closer can
  // start is one past the opener's own run.
  for (let at = text.indexOf(delimiter, open + width + 1); at !== -1; ) {
    if (!/\s/.test(text[at - 1])) return true;
    at = text.indexOf(delimiter, at + 1);
  }
  return false;
}

const LINK_OR_IMAGE = /!?\[[^\]]*\]\([^\s)]+\)/;
const CODE_SPAN = /`[^`\n]+`/;

/** Inline syntax: ambiguous on its own, so two different ones are required. */
const INLINE_SIGNALS: Array<(text: string) => boolean> = [
  (text) => LINK_OR_IMAGE.test(text),
  (text) => hasDelimitedPair(text, '**'), // bold
  (text) => hasDelimitedPair(text, '~~'), // strikethrough
  (text) => CODE_SPAN.test(text)
];

/**
 * Is this plain text worth parsing as Markdown?
 *
 * Deliberately conservative. This decides whether a paste gets rewritten, and
 * silently restructuring someone's prose because it happened to start with a
 * hyphen is worse than leaving a bit of Markdown untouched. One unambiguous
 * block construct will do; inline syntax has to show up twice before it counts,
 * since a single pair of asterisks in ordinary writing is not an intent.
 */
export function looksLikeMarkdown(text: string): boolean {
  if (!text.trim()) return false;
  if (BLOCK_SIGNALS.some((pattern) => pattern.test(text))) return true;
  return INLINE_SIGNALS.filter((matches) => matches(text)).length >= 2;
}
