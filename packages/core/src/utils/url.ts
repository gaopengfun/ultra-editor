const SAFE_LINK_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];
const SAFE_IMAGE_PROTOCOLS = ['http:', 'https:', 'data:', 'blob:'];

function protocolOf(url: string): string | null {
  const trimmed = url.trim();
  // Relative URLs carry no protocol and cannot smuggle a scripting scheme.
  if (/^[./?#]/.test(trimmed)) return null;
  const match = /^([a-z][a-z0-9+\-.]*):/i.exec(trimmed);
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
  if (protocol === 'data:') return /^data:image\/[a-z0-9.+-]+;/i.test(url.trim());
  return true;
}
