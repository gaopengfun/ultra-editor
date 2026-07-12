import { describe, expect, it } from 'vitest';
import { isSafeImageUrl, isSafeLinkUrl } from './url';

// Built explicitly: raw control characters in a test file are invisible to a
// reviewer and get mangled by tooling.
const NUL = String.fromCharCode(0);
const SOH = String.fromCharCode(1);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);

describe('isSafeLinkUrl', () => {
  it('accepts the protocols a document legitimately links to', () => {
    expect(isSafeLinkUrl('https://example.com')).toBe(true);
    expect(isSafeLinkUrl('http://example.com')).toBe(true);
    expect(isSafeLinkUrl('mailto:a@b.com')).toBe(true);
    expect(isSafeLinkUrl('/relative/path')).toBe(true);
    expect(isSafeLinkUrl('#anchor')).toBe(true);
  });

  it('rejects scripting schemes, including obfuscated ones', () => {
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeLinkUrl('data:text/html,<script>')).toBe(false);
  });

  // A URL parser discards these characters, so a scheme split across them is still
  // a scheme to the browser. Matching the raw string let every one of these through.
  it.each([
    ['tab inside the scheme', `java${TAB}script:alert(1)`],
    ['newline inside the scheme', `java${LF}script:alert(1)`],
    ['carriage return inside the scheme', `java${CR}script:alert(1)`],
    ['leading C0 control', `${SOH}javascript:alert(1)`],
    ['leading NUL', `${NUL}javascript:alert(1)`],
    ['several controls at once', `ja${TAB}va${LF}scr${NUL}ipt:alert(1)`]
  ])('rejects javascript: smuggled via %s', (_label, url) => {
    expect(isSafeLinkUrl(url)).toBe(false);
    expect(isSafeImageUrl(url)).toBe(false);
  });
});

describe('isSafeImageUrl', () => {
  it('accepts image sources', () => {
    expect(isSafeImageUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeImageUrl('blob:https://example.com/uuid')).toBe(true);
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeImageUrl('data:image/svg+xml,<svg/>')).toBe(true);
    expect(isSafeImageUrl('/uploads/a.png')).toBe(true);
  });

  it('rejects a data URL that is not actually an image', () => {
    expect(isSafeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
  });
});

// Neither the relative-path shortcut nor the scheme pattern fires on these, so
// they exercise the "no protocol at all" fallthrough rather than an early exit.
describe('schemeless URLs', () => {
  it('accepts a bare path that starts with neither a scheme nor a path marker', () => {
    expect(isSafeLinkUrl('example.com/page')).toBe(true);
    expect(isSafeImageUrl('uploads/a.png')).toBe(true);
  });

  it('accepts an empty URL', () => {
    expect(isSafeLinkUrl('')).toBe(true);
    expect(isSafeImageUrl('')).toBe(true);
  });
});
