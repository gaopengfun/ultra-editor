import { describe, expect, it } from 'vitest';
import { isSafeImageUrl, isSafeLinkUrl } from './url';

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
});

describe('isSafeImageUrl', () => {
  it('accepts image sources', () => {
    expect(isSafeImageUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeImageUrl('blob:https://example.com/uuid')).toBe(true);
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(isSafeImageUrl('/uploads/a.png')).toBe(true);
  });

  it('rejects a data URL that is not actually an image', () => {
    expect(isSafeImageUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
  });
});
