import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasToBlob, loadImage, rotateImage, transformImage } from './image';

const SRC = 'https://cdn.test/photo.png';
const OBJECT_URL = 'blob:ultra/1';

/**
 * jsdom neither decodes images nor fires `load`/`error` when `src` is assigned,
 * so the element has to be faked to reach either outcome.
 */
class FakeImage {
  crossOrigin: string | null = null;
  naturalWidth = 40;
  naturalHeight = 20;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(value: string) {
    loaded.push(value);
    queueMicrotask(() => (decodes ? this.onload?.() : this.onerror?.()));
  }
}

function fakeContext() {
  return {
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn()
  };
}

/** Sources handed to `new Image()`, in order — the object URL, or the raw src on fallback. */
let loaded: string[];
let decodes: boolean;
let context: ReturnType<typeof fakeContext>;
let contextAvailable: boolean;
/** The canvas is sized before `getContext` is called, so the spy can read its dimensions off. */
let canvasSize: { width: number; height: number } | undefined;
let exported: Blob | null;
let exportedType: string | undefined;
let source: Blob;

beforeEach(() => {
  loaded = [];
  decodes = true;
  context = fakeContext();
  contextAvailable = true;
  canvasSize = undefined;
  source = new Blob(['bytes'], { type: 'image/png' });
  exported = new Blob(['encoded'], { type: 'image/png' });
  exportedType = undefined;

  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue(OBJECT_URL);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    canvasSize = { width: this.width, height: this.height };
    return contextAvailable ? (context as unknown as CanvasRenderingContext2D) : null;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    exportedType = type;
    callback(exported);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadImage', () => {
  it('resolves with the element once the source decodes', async () => {
    const img = await loadImage(OBJECT_URL);

    expect(loaded).toEqual([OBJECT_URL]);
    // Without this the canvas is tainted and toBlob throws on cross-origin sources.
    expect(img.crossOrigin).toBe('anonymous');
  });

  it('rejects with image-load-failed when the source cannot be decoded', async () => {
    decodes = false;
    await expect(loadImage('/broken.png')).rejects.toThrow('image-load-failed');
  });
});

describe('canvasToBlob', () => {
  it('resolves with the encoded blob and asks for PNG by default', async () => {
    await expect(canvasToBlob(document.createElement('canvas'))).resolves.toBe(exported);
    expect(exportedType).toBe('image/png');
  });

  it('encodes as the requested MIME type when one is given', async () => {
    await canvasToBlob(document.createElement('canvas'), 'image/jpeg');
    expect(exportedType).toBe('image/jpeg');
  });

  it('rejects with canvas-export-failed when the canvas yields no blob', async () => {
    exported = null;
    await expect(canvasToBlob(document.createElement('canvas'))).rejects.toThrow(
      'canvas-export-failed'
    );
  });
});

describe('transformImage', () => {
  it('pulls the source through the fetcher and hands the canvas an object URL', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    await transformImage(SRC, {}, fetchImage);

    expect(fetchImage).toHaveBeenCalledWith(SRC);
    expect(URL.createObjectURL).toHaveBeenCalledWith(source);
    expect(loaded).toEqual([OBJECT_URL]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('falls back to the raw src when the source cannot be fetched', async () => {
    const fetchImage = vi.fn(() => Promise.reject(new Error('cors')));
    await transformImage(SRC, {}, fetchImage);

    expect(loaded).toEqual([SRC]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('defaults the crop to the natural size and draws the whole frame around the centre', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    await transformImage(SRC, {}, fetchImage);

    expect(canvasSize).toEqual({ width: 40, height: 20 });
    expect(context.translate).toHaveBeenCalledWith(20, 10);
    expect(context.rotate).not.toHaveBeenCalled();
    expect(context.scale).toHaveBeenCalledWith(1, 1);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      40,
      20,
      -20,
      -10,
      40,
      20
    );
  });

  it('sizes the canvas to an explicit crop box and reads that box out of the source', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    await transformImage(SRC, { crop: { left: 5, top: 6, width: 10, height: 8 } }, fetchImage);

    expect(canvasSize).toEqual({ width: 10, height: 8 });
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 5, 6, 10, 8, -5, -4, 10, 8);
  });

  it.each([
    [90, Math.PI / 2],
    [-90, -Math.PI / 2],
    [270, (270 * Math.PI) / 180],
    [-270, (-270 * Math.PI) / 180]
  ] as const)('swaps the canvas dimensions on a %d° quarter turn', async (degrees, radians) => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    await transformImage(SRC, { rotate: degrees }, fetchImage);

    expect(canvasSize).toEqual({ width: 20, height: 40 });
    expect(context.rotate).toHaveBeenCalledWith(radians);
  });

  it('keeps the canvas dimensions on a half turn', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    await transformImage(SRC, { rotate: 180 }, fetchImage);

    expect(canvasSize).toEqual({ width: 40, height: 20 });
    expect(context.rotate).toHaveBeenCalledWith(Math.PI);
  });

  it.each([
    ['horizontally', { flipH: true }, [-1, 1]],
    ['vertically', { flipV: true }, [1, -1]],
    ['on both axes', { flipH: true, flipV: true }, [-1, -1]]
  ] as const)('mirrors %s by negating the matching axis', async (_label, transform, scale) => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    await transformImage(SRC, transform, fetchImage);

    expect(context.scale).toHaveBeenCalledWith(scale[0], scale[1]);
  });

  it('throws canvas-unavailable and still revokes the object URL when there is no 2D context', async () => {
    contextAvailable = false;
    const fetchImage = vi.fn(() => Promise.resolve(source));

    await expect(transformImage(SRC, {}, fetchImage)).rejects.toThrow('canvas-unavailable');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });
});

describe('rotateImage', () => {
  it('forwards the degrees and the fetcher to the transform', async () => {
    const fetchImage = vi.fn(() => Promise.resolve(source));
    const blob = await rotateImage(SRC, -90, fetchImage);

    expect(fetchImage).toHaveBeenCalledWith(SRC);
    expect(context.rotate).toHaveBeenCalledWith(-Math.PI / 2);
    expect(canvasSize).toEqual({ width: 20, height: 40 });
    expect(blob).toBe(exported);
  });

  it('falls back to the default same-origin fetcher when none is injected', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(source) } as unknown as Response)
    );
    vi.stubGlobal('fetch', fetch);

    await rotateImage(SRC, 90);

    expect(fetch).toHaveBeenCalledWith(SRC, { credentials: 'same-origin' });
    expect(loaded).toEqual([OBJECT_URL]);
  });
});
