import { describe, expect, it } from 'vitest';
import { contrastText } from './color';

const DARK = '#1f2937';
const LIGHT = '#ffffff';

describe('contrastText', () => {
  it('puts dark text on a light fill and white text on a dark one', () => {
    expect(contrastText('#fef08a')).toBe(DARK);
    expect(contrastText('#111111')).toBe(LIGHT);
  });

  it('expands a 3-digit hex to the same colour as its 6-digit form', () => {
    expect(contrastText('#fff')).toBe(contrastText('#ffffff'));
    expect(contrastText('#fff')).toBe(DARK);
    expect(contrastText('#000')).toBe(LIGHT);
  });

  it('reads a hex value regardless of case or surrounding whitespace', () => {
    expect(contrastText('  #FEF08A  ')).toBe(DARK);
  });

  it('reads the channels out of rgb() and rgba()', () => {
    expect(contrastText('rgb(255, 255, 255)')).toBe(DARK);
    expect(contrastText('rgba(0, 0, 0, 0.5)')).toBe(LIGHT);
    // The space-separated CSS Color 4 form parses too.
    expect(contrastText('rgb(17 17 17)')).toBe(LIGHT);
  });

  // Grey channels weigh out to exactly value/255, which pins the 0.6 cut-off:
  // #999 is 153/255 = 0.6 (not greater), #9a9a9a is one step over it.
  it('treats a luminance of exactly 0.6 as dark and anything above it as light', () => {
    expect(contrastText('#999999')).toBe(LIGHT);
    expect(contrastText('#9a9a9a')).toBe(DARK);
  });

  it('falls back to white text for a colour it cannot parse', () => {
    expect(contrastText('hsl(0 0% 100%)')).toBe(LIGHT);
    expect(contrastText('transparent')).toBe(LIGHT);
    expect(contrastText('#ff')).toBe(LIGHT);
    expect(contrastText('')).toBe(LIGHT);
  });
});
