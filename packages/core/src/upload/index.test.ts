import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAX_IMAGE_SIZE,
  dataUrlUpload,
  defaultImageFetcher,
  formatSize,
  isAcceptedFile,
  resolveUploadOptions
} from './index';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveUploadOptions', () => {
  it('falls back to the data-URL upload, the same-origin fetcher, 5 MB and images only', () => {
    const resolved = resolveUploadOptions();

    expect(resolved.upload).toBe(dataUrlUpload);
    expect(resolved.fetchImage).toBe(defaultImageFetcher);
    expect(resolved.maxSize).toBe(DEFAULT_MAX_IMAGE_SIZE);
    expect(DEFAULT_MAX_IMAGE_SIZE).toBe(5 * 1024 * 1024);
    expect(resolved.accept).toEqual(['image/']);
  });

  it('takes the caller value for every option it supplies', () => {
    const upload = async () => 'https://cdn.example.com/a.png';
    const fetchImage = async () => new Blob();
    const resolved = resolveUploadOptions({
      upload,
      fetchImage,
      maxSize: 128,
      accept: ['image/png', 'video/']
    });

    expect(resolved).toEqual({ upload, fetchImage, maxSize: 128, accept: ['image/png', 'video/'] });
  });
});

describe('dataUrlUpload', () => {
  it('inlines the blob as a data URL', async () => {
    const url = await dataUrlUpload(new Blob(['hello'], { type: 'text/plain' }));

    expect(url.startsWith('data:text/plain;base64,')).toBe(true);
  });

  it('rejects with read-failed when the FileReader errors', async () => {
    class BrokenFileReader {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      result: string | null = null;
      readAsDataURL() {
        this.onerror?.();
      }
    }
    vi.stubGlobal('FileReader', BrokenFileReader);

    await expect(dataUrlUpload(new Blob(['x']))).rejects.toThrow('read-failed');
  });
});

describe('defaultImageFetcher', () => {
  it('never sends credentials cross-origin — the src comes from document content', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, blob: async () => new Blob() });
    vi.stubGlobal('fetch', fetchMock);

    await defaultImageFetcher('https://evil.example.com/track.png');

    expect(fetchMock).toHaveBeenCalledWith('https://evil.example.com/track.png', {
      credentials: 'same-origin'
    });
  });

  it('hands back the fetched blob', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => blob })
    );

    await expect(defaultImageFetcher('/a.png')).resolves.toBe(blob);
  });

  it('throws fetch-failed with the status when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(defaultImageFetcher('/missing.png')).rejects.toThrow('fetch-failed: 404');
  });
});

describe('isAcceptedFile', () => {
  it('accepts a file whose MIME type starts with an allowed prefix', () => {
    expect(isAcceptedFile(new Blob([], { type: 'image/png' }), ['image/'])).toBe(true);
  });

  it('rejects a file whose MIME type matches no prefix', () => {
    expect(isAcceptedFile(new Blob([], { type: 'application/pdf' }), ['image/'])).toBe(false);
  });

  it('rejects a blob that carries no MIME type at all', () => {
    expect(isAcceptedFile(new Blob([]), ['image/'])).toBe(false);
  });
});

describe('formatSize', () => {
  it('reports megabytes to two decimal places', () => {
    expect(formatSize(DEFAULT_MAX_IMAGE_SIZE)).toBe('5.00MB');
    expect(formatSize(1.5 * 1024 * 1024)).toBe('1.50MB');
    expect(formatSize(1024)).toBe('0.00MB');
  });
});
