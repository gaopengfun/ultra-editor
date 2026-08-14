import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBrowser } from './env';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isBrowser', () => {
  it('is true under a real DOM', () => {
    expect(isBrowser()).toBe(true);
  });

  // The SDK is imported in SSR apps, where one or both of these are missing.
  // Every DOM touch in core is gated on this, so both halves have to hold.
  it('is false when there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(isBrowser()).toBe(false);
  });

  it('is false when there is a window but no document', () => {
    vi.stubGlobal('document', undefined);
    expect(isBrowser()).toBe(false);
  });
});
