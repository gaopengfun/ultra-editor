import type { ImageFetcher } from '../upload';
import { defaultImageFetcher } from '../upload';

/**
 * Pull the source through fetch and hand the canvas a same-origin object URL.
 * Pointing a canvas straight at a cross-origin `src` taints it and makes
 * `toBlob` throw; going via a blob sidesteps that entirely.
 */
async function srcToObjectUrl(
  src: string,
  fetchImage: ImageFetcher
): Promise<{ url: string; revoke: () => void }> {
  try {
    const blob = await fetchImage(src);
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch {
    // Same-origin sources still export fine from the raw src; cross-origin ones
    // will surface as a toBlob error that the caller reports.
    return { url: src, revoke: () => {} };
  }
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image-load-failed'));
    img.src = url;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas-export-failed'))),
      type
    );
  });
}

export interface ImageTransform {
  /** Degrees clockwise; only right angles are supported. */
  rotate?: 0 | 90 | 180 | 270 | -90 | -180 | -270;
  flipH?: boolean;
  flipV?: boolean;
  /** Crop box in natural pixels of the source image, applied before rotation. */
  crop?: { left: number; top: number; width: number; height: number };
}

/**
 * Rasterise a transform into a new blob. Rotation is a real pixel rotation, not
 * a CSS transform, so the result survives serialisation into plain HTML.
 */
export async function transformImage(
  src: string,
  transform: ImageTransform,
  fetchImage: ImageFetcher = defaultImageFetcher
): Promise<Blob> {
  const { url, revoke } = await srcToObjectUrl(src, fetchImage);
  try {
    const img = await loadImage(url);
    const crop = transform.crop ?? {
      left: 0,
      top: 0,
      width: img.naturalWidth,
      height: img.naturalHeight
    };
    const rotate = (transform.rotate ?? 0) % 360;
    const quarterTurn = Math.abs(rotate) === 90 || Math.abs(rotate) === 270;

    const canvas = document.createElement('canvas');
    canvas.width = quarterTurn ? crop.height : crop.width;
    canvas.height = quarterTurn ? crop.width : crop.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas-unavailable');

    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (rotate) ctx.rotate((rotate * Math.PI) / 180);
    ctx.scale(transform.flipH ? -1 : 1, transform.flipV ? -1 : 1);
    ctx.drawImage(
      img,
      crop.left,
      crop.top,
      crop.width,
      crop.height,
      -crop.width / 2,
      -crop.height / 2,
      crop.width,
      crop.height
    );

    return await canvasToBlob(canvas);
  } finally {
    revoke();
  }
}

/** Convenience wrapper for the right-click rotate action. */
export const rotateImage = (
  src: string,
  degrees: 90 | -90,
  fetchImage?: ImageFetcher
): Promise<Blob> => transformImage(src, { rotate: degrees }, fetchImage);
