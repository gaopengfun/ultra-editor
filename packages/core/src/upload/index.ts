/**
 * The single seam between ultra-editor and your backend. The SDK never knows
 * your upload URL, your auth scheme, or your HTTP client — you hand it a
 * function that turns a Blob into a URL, and that's the whole contract.
 */
export type UploadHandler = (file: Blob, filename?: string) => Promise<string>;

/** How the editor pulls an existing image back down for rotate/crop re-encoding. */
export type ImageFetcher = (src: string) => Promise<Blob>;

export const DEFAULT_MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export interface UploadOptions {
  /** Upload a blob, return its public URL. Defaults to an in-memory data URL. */
  upload?: UploadHandler;
  /** Fetch an image back as a blob. Defaults to a same-origin `fetch`. */
  fetchImage?: ImageFetcher;
  /** Reject anything larger, in bytes. Default 5 MB. */
  maxSize?: number;
  /** Accepted MIME prefixes. Default `['image/']`. */
  accept?: string[];
}

/**
 * Fallback when no upload handler is injected: inline the image as a data URL.
 * Good enough for demos and local drafts, wrong for production — a 2 MB photo
 * becomes 2.7 MB of base64 inside your HTML. The docs say so loudly.
 */
export const dataUrlUpload: UploadHandler = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });

/**
 * Default image fetcher. Pulling the bytes through fetch (rather than pointing
 * a canvas at the remote URL) is what keeps `canvas.toBlob` from throwing on a
 * tainted canvas for cross-origin images.
 */
export const defaultImageFetcher: ImageFetcher = async (src) => {
  // `same-origin`, not `include`: the src comes straight from document content,
  // so `include` would fire a cookie-bearing cross-origin GET at any URL an
  // author (or a paste) put in the document. Hosts that need credentials on
  // their own image host inject a `fetchImage` that opts back in.
  const response = await fetch(src, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`fetch-failed: ${response.status}`);
  return response.blob();
};

export interface ResolvedUpload {
  upload: UploadHandler;
  fetchImage: ImageFetcher;
  maxSize: number;
  accept: string[];
}

export function resolveUploadOptions(options: UploadOptions = {}): ResolvedUpload {
  return {
    upload: options.upload ?? dataUrlUpload,
    fetchImage: options.fetchImage ?? defaultImageFetcher,
    maxSize: options.maxSize ?? DEFAULT_MAX_IMAGE_SIZE,
    accept: options.accept ?? ['image/']
  };
}

export function isAcceptedFile(file: File | Blob, accept: string[]): boolean {
  const type = file.type || '';
  return accept.some((prefix) => type.startsWith(prefix));
}

export function formatSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}
