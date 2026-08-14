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

/** Inline syntax: ambiguous on its own, so two different ones are required. */
const INLINE_SIGNALS = [
  /!?\[[^\]]*\]\([^\s)]+\)/, // link or image
  /\*\*(?=\S)[\s\S]*?\S\*\*/, // bold
  /~~(?=\S)[\s\S]*?\S~~/, // strikethrough
  /`[^`\n]+`/ // code span
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
  return INLINE_SIGNALS.filter((pattern) => pattern.test(text)).length >= 2;
}
