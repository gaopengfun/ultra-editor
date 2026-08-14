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

export interface ImageProcessingLimits {
  /** Reject decoded sources above this pixel count before allocating a canvas. */
  maxSourcePixels?: number;
  /** Downscale exports so their canvas never exceeds this pixel count. */
  maxOutputPixels?: number;
  /** Downscale exports so neither canvas edge exceeds this size. */
  maxDimension?: number;
}

export const DEFAULT_IMAGE_PROCESSING_LIMITS: Required<ImageProcessingLimits> = {
  maxSourcePixels: 80_000_000,
  maxOutputPixels: 16_000_000,
  maxDimension: 8192
};

function positiveLimit(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Rasterise a transform into a new blob. Rotation is a real pixel rotation, not
 * a CSS transform, so the result survives serialisation into plain HTML.
 */
export async function transformImage(
  src: string,
  transform: ImageTransform,
  fetchImage: ImageFetcher = defaultImageFetcher,
  limits: ImageProcessingLimits = {}
): Promise<Blob> {
  const { url, revoke } = await srcToObjectUrl(src, fetchImage);
  try {
    const img = await loadImage(url);
    const maxSourcePixels = positiveLimit(
      limits.maxSourcePixels,
      DEFAULT_IMAGE_PROCESSING_LIMITS.maxSourcePixels
    );
    if (
      !img.naturalWidth ||
      !img.naturalHeight ||
      img.naturalWidth * img.naturalHeight > maxSourcePixels
    ) {
      throw new Error('image-too-large-to-process');
    }
    const crop = transform.crop ?? {
      left: 0,
      top: 0,
      width: img.naturalWidth,
      height: img.naturalHeight
    };
    const rotate = (transform.rotate ?? 0) % 360;
    const quarterTurn = Math.abs(rotate) === 90 || Math.abs(rotate) === 270;
    const sourceWidth = quarterTurn ? crop.height : crop.width;
    const sourceHeight = quarterTurn ? crop.width : crop.height;
    const maxOutputPixels = positiveLimit(
      limits.maxOutputPixels,
      DEFAULT_IMAGE_PROCESSING_LIMITS.maxOutputPixels
    );
    const maxDimension = positiveLimit(
      limits.maxDimension,
      DEFAULT_IMAGE_PROCESSING_LIMITS.maxDimension
    );
    const outputScale = Math.min(
      1,
      maxDimension / sourceWidth,
      maxDimension / sourceHeight,
      Math.sqrt(maxOutputPixels / (sourceWidth * sourceHeight))
    );

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
    canvas.height = Math.max(1, Math.round(sourceHeight * outputScale));

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
      -(crop.width * outputScale) / 2,
      -(crop.height * outputScale) / 2,
      crop.width * outputScale,
      crop.height * outputScale
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
  fetchImage?: ImageFetcher,
  limits?: ImageProcessingLimits
): Promise<Blob> => transformImage(src, { rotate: degrees }, fetchImage, limits);
