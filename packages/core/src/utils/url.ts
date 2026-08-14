const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const SAFE_IMAGE_PROTOCOLS = ['http:', 'https:', 'data:', 'blob:'];

const SPACE = 0x20;
const DEL = 0x7f;

/**
 * Drop the characters a URL parser ignores, so they cannot smuggle a scheme past us.
 *
 * Browsers strip ASCII tab / LF / CR from anywhere in a URL, and trim leading C0
 * controls and spaces, before parsing. So `java\tscript:alert(1)` is a perfectly
 * good `javascript:` URL to the browser, while looking like a harmless relative
 * path to a naive regex. Detection has to see what the parser sees.
 *
 * Written as a code-point scan rather than a regex character class: control
 * characters in a source file are too easy to mangle, and impossible to review.
 */
function forProtocolDetection(url: string): string {
  let cleaned = '';
  for (const char of url) {
    // `for...of` walks code points, so `char` is never empty and `codePointAt`
    // never comes back undefined — the `??` is for the type, not for a real case.
    /* v8 ignore next */
    const code = char.codePointAt(0) ?? 0;
    if (code <= SPACE || code === DEL) continue;
    cleaned += char;
  }
  return cleaned;
}

function protocolOf(url: string): string | null {
  const cleaned = forProtocolDetection(url);
  // Relative URLs carry no scheme and cannot smuggle one.
  if (/^[./?#]/.test(cleaned)) return null;
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(cleaned);
  return match ? match[1].toLowerCase() + ':' : null;
}

/** Links written into the document: block `javascript:` and friends. */
export function isSafeLinkUrl(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol === null || SAFE_LINK_PROTOCOLS.includes(protocol);
}

/**
 * Image sources. `data:` is allowed but only for real image payloads — a
 * `data:text/html` src is an XSS vector in some renderers.
 */
export function isSafeImageUrl(url: string): boolean {
  const protocol = protocolOf(url);
  if (protocol === null) return true;
  if (!SAFE_IMAGE_PROTOCOLS.includes(protocol)) return false;
  if (protocol === 'data:') {
    return /^data:image\/[a-z0-9.+-]+[;,]/i.test(forProtocolDetection(url));
  }
  return true;
}
