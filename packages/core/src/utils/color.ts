function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split('')
        .map((x) => x + x)
        .join('');
    }
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** A colour as the picker holds it: hue in degrees, saturation and value in 0–1. */
export interface HSV {
  h: number;
  s: number;
  v: number;
}

const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0');

/**
 * Any accepted colour → `#rrggbb`, or null if it is not one.
 *
 * Takes a bare `abc` as readily as `#abc`, because that is what people type into
 * a hex field once the label has already told them it wants hex.
 */
export function normalizeHex(color: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1].length === 3 ? match[1].replace(/./g, (digit) => digit + digit) : match[1];
  return `#${hex.toLowerCase()}`;
}

/**
 * Hex → HSV, the space a two-dimensional picker actually moves in.
 *
 * Grey has no hue to report — every channel is equal, so the angle is undefined
 * rather than zero. Returning 0 is the usual stand-in and it costs the caller a
 * red tint the moment they drag saturation up from a grey; the panel works around
 * it by keeping the hue it was already showing.
 */
export function hexToHsv(color: string): HSV | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? delta / max : 0, v: max };
}

/** HSV → `#rrggbb`. The inverse of `hexToHsv`, give or take a rounded channel. */
export function hsvToHex({ h, s, v }: HSV): string {
  const chroma = v * s;
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const base = v - chroma;
  const sector = Math.floor(h / 60) % 6;
  const channels: Array<[number, number, number]> = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second]
  ];
  return `#${channels[sector].map((channel) => toHex((channel + base) * 255)).join('')}`;
}

const INK_DARK = '#1f2937';
const INK_LIGHT = '#ffffff';

/** WCAG relative luminance. Channels are gamma-encoded, so they linearise first. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

const contrastRatio = (a: number, b: number) =>
  a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05);

/**
 * Readable text colour for a given background — keeps table cells legible at any fill.
 *
 * Measures both candidates and keeps the better one rather than comparing a
 * brightness figure against a cut-off. The two disagree across the mid-tones:
 * weighting gamma-encoded channels overstates how light a saturated mid colour
 * is, so a threshold puts white on fills where white is the harder of the two to
 * read — `#51a5dc` scores 2.7:1 against white and 5.4:1 against the dark ink.
 */
const INK_DARK_LUMINANCE = relativeLuminance([0x1f, 0x29, 0x37]);
const INK_LIGHT_LUMINANCE = 1;

export function contrastText(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return INK_LIGHT;
  const background = relativeLuminance(rgb);
  const onDark = contrastRatio(background, INK_DARK_LUMINANCE);
  const onLight = contrastRatio(background, INK_LIGHT_LUMINANCE);
  return onDark > onLight ? INK_DARK : INK_LIGHT;
}
