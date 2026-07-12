import { describe, expect, it } from 'vitest';
import { createTranslator, en, zhCN, type LocaleName, type MessageKey } from './index';

describe('createTranslator', () => {
  it('serves Chinese when no locale is given', () => {
    expect(createTranslator()('toolbar.bold')).toBe('加粗');
  });

  it('serves the English table for `en`', () => {
    expect(createTranslator('en')('toolbar.bold')).toBe('Bold');
  });

  it('falls back to Chinese for a locale that has no built-in table', () => {
    expect(createTranslator('fr-FR' as LocaleName)('toolbar.bold')).toBe('加粗');
  });

  it('lets an override rewrite one string without forking the locale', () => {
    const t = createTranslator('en', { 'toolbar.bold': 'Make it heavy' });

    expect(t('toolbar.bold')).toBe('Make it heavy');
    expect(t('toolbar.italic')).toBe('Italic');
  });

  it('returns the key itself for an unknown key rather than rendering undefined', () => {
    expect(createTranslator()('toolbar.nope' as MessageKey)).toBe('toolbar.nope');
  });

  it('interpolates {name} placeholders from vars', () => {
    expect(createTranslator('en')('table.pick', { rows: 2, cols: 3 })).toBe('Insert 2 × 3 table');
  });

  it('leaves a placeholder with no matching var in place rather than printing undefined', () => {
    expect(createTranslator('en')('image.tooLarge', { size: '9.00MB' })).toBe(
      'Image is 9.00MB, exceeding the {max} limit'
    );
  });

  it('skips interpolation entirely when called with no vars', () => {
    expect(createTranslator('en')('stats.words')).toBe('{n} words');
  });
});

describe('message tables', () => {
  // Guards the CLAUDE.md rule that a user-facing string lives in both locales:
  // adding a key to only one of them makes it silently render as the raw key.
  it('keeps zhCN and en on identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  });

  it('leaves no string blank in either table', () => {
    const blank = [...Object.entries(zhCN), ...Object.entries(en)].filter(
      ([, value]) => value.trim() === ''
    );

    expect(blank).toEqual([]);
  });

  it('keeps the same placeholders on both sides of a translated pair', () => {
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();

    for (const key of Object.keys(zhCN) as MessageKey[]) {
      expect(placeholders(en[key])).toEqual(placeholders(zhCN[key]));
    }
  });
});
