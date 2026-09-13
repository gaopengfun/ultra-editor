import { describe, expect, it } from 'vitest';
import { contrastText, hexToHsv, hsvToHex, normalizeHex } from './color';

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

  // The mid-tones are where a brightness guess and a real contrast measurement
  // disagree. Every one of these reads under 4:1 against white and over 4.4:1
  // against the dark ink, so white text on them is the unreadable choice.
  it('picks the more readable ink for mid-tone fills, not the brighter-looking one', () => {
    expect(contrastText('#51a5dc')).toBe(DARK);
    expect(contrastText('#ca8a04')).toBe(DARK);
    expect(contrastText('#16a34a')).toBe(DARK);
    expect(contrastText('#ea580c')).toBe(DARK);
  });

  // Greys cross over where the two inks are equally readable — around 3.8:1
  // each. One 8-bit step either side of the crossing flips the answer.
  it('switches ink at the point where the two contrast ratios cross', () => {
    expect(contrastText('#828282')).toBe(LIGHT);
    expect(contrastText('#838383')).toBe(DARK);
  });

  it('falls back to white text for a colour it cannot parse', () => {
    expect(contrastText('hsl(0 0% 100%)')).toBe(LIGHT);
    expect(contrastText('transparent')).toBe(LIGHT);
    expect(contrastText('#ff')).toBe(LIGHT);
    expect(contrastText('')).toBe(LIGHT);
  });
});

describe('normalizeHex', () => {
  it('expands shorthand and settles on one casing', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
  });

  it('takes a hex without its hash, and ignores surrounding space', () => {
    // What people type into a field already labelled "hex".
    expect(normalizeHex('5b5bd6')).toBe('#5b5bd6');
    expect(normalizeHex('  #5b5bd6  ')).toBe('#5b5bd6');
  });

  it('rejects anything that is not a hex colour', () => {
    expect(normalizeHex('#ff')).toBeNull();
    expect(normalizeHex('#abcde')).toBeNull();
    expect(normalizeHex('rgb(1, 2, 3)')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
});

describe('hexToHsv and hsvToHex', () => {
  it('reads the primaries off the colour wheel', () => {
    expect(hexToHsv('#ff0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00ff00')).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv('#0000ff')).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('reports no saturation for a grey, and value as its brightness', () => {
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#ffffff')).toEqual({ h: 0, s: 0, v: 1 });
    expect(hexToHsv('#808080')?.s).toBe(0);
  });

  it('round-trips a colour through HSV and back', () => {
    for (const hex of ['#5b5bd6', '#51a5dc', '#facc15', '#1f2937', '#ffffff', '#000000']) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
    }
  });

  it('writes the top of the wheel as red, the same as the bottom', () => {
    // 360° is the rail's far end; the sector maths has to wrap it back to 0.
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000');
  });

  it('returns null for a colour it cannot parse', () => {
    expect(hexToHsv('transparent')).toBeNull();
  });
});
