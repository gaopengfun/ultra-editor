import { describe, expect, it } from 'vitest';
import { resolveProvider, resolveToggle } from './types';
import type { AIProvider } from './types';

/** Two of these are distinguishable only by identity — that is all these tests need. */
const stub = (tag: string): AIProvider => ({
  async *stream() {
    yield tag;
  }
});

describe('resolveProvider', () => {
  it('hands back a provider passed in directly', () => {
    const provider = stub('a');
    expect(resolveProvider(provider)).toBe(provider);
  });

  it('calls a getter and hands back what it returns', () => {
    const provider = stub('a');
    expect(resolveProvider(() => provider)).toBe(provider);
  });

  it('normalises every way of having no provider to null', () => {
    expect(resolveProvider(null)).toBeNull();
    expect(resolveProvider(undefined)).toBeNull();
    expect(resolveProvider(() => null)).toBeNull();
    expect(resolveProvider(() => undefined)).toBeNull();
  });

  it('sees the new provider once the host swaps it, because it re-reads the getter', () => {
    // Extensions are built once, when the editor is created — often before the
    // host's provider exists. Freezing the value then would strand the editor on
    // whatever was there at construction time.
    let current: AIProvider | null = null;
    const source = () => current;

    expect(resolveProvider(source)).toBeNull();

    const arrived = stub('late');
    current = arrived;

    expect(resolveProvider(source)).toBe(arrived);
  });
});

describe('resolveToggle', () => {
  it('hands back a boolean as given', () => {
    expect(resolveToggle(true)).toBe(true);
    expect(resolveToggle(false)).toBe(false);
  });

  it('re-reads a getter, so a host can flip the switch after construction', () => {
    let on = false;
    const toggle = () => on;

    expect(resolveToggle(toggle)).toBe(false);
    on = true;
    expect(resolveToggle(toggle)).toBe(true);
  });

  it('falls back only when the toggle is undefined — an explicit false still wins', () => {
    expect(resolveToggle(undefined)).toBe(false);
    expect(resolveToggle(undefined, true)).toBe(true);
    expect(resolveToggle(false, true)).toBe(false);
  });
});
