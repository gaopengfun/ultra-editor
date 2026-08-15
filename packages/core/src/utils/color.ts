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

/** Readable text colour for a given background — keeps table cells legible at any fill. */
export function contrastText(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#ffffff';
}
