import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createTranslator, type ImageFetcher } from '@ultra-editor/core';
import UeCropper from './UeCropper.vue';

/**
 * jsdom has no canvas and decodes no images, so the export path — a real
 * `transformImage` from core — has to be given all three: a 2D context, a
 * `toBlob`, and an `Image` that actually loads. Everything the maths is asserted
 * on below comes back out of these.
 */
const ctx = {
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  drawImage: vi.fn()
};

let exported: HTMLCanvasElement | null = null;
let toBlobResult: Blob | null = null;

/** The canvas core exports through is never attached to the document; catch it here. */
function contextFor(canvas: HTMLCanvasElement) {
  exported = canvas;
  return ctx as unknown as CanvasRenderingContext2D;
}

class FakeImage {
  crossOrigin = '';
  naturalWidth = 800;
  naturalHeight = 600;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = '';

  get src() {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
    queueMicrotask(() => this.onload?.());
  }
}

/** jsdom reports every rect as 0×0; the cropper needs a stage with a real size. */
const rect = (width: number, height: number) =>
  ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({})
  }) as DOMRect;

let wrapper: VueWrapper;
let fetchImage: ImageFetcher;

const stage = () => document.body.querySelector<HTMLElement>('.ue-crop__stage');
const image = () => document.body.querySelector<HTMLImageElement>('.ue-crop__img');
const canvas = () => document.body.querySelector<HTMLElement>('.ue-crop__canvas');
const box = () => document.body.querySelector<HTMLElement>('.ue-crop__box');
const handle = (corner: 'nw' | 'ne' | 'sw' | 'se') =>
  document.body.querySelector<HTMLElement>(`.ue-crop__handle--${corner}`);
const tool = (title: string) =>
  document.body.querySelector<HTMLButtonElement>(`.ue-crop__tools .ue-btn[title="${title}"]`);
const footerButton = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-dialog__footer .ue-btn')).find(
    (entry) => entry.textContent?.trim() === label
  );

async function open(
  options: { src?: string; fetchImage?: ImageFetcher | undefined; omitFetcher?: boolean } = {}
) {
  wrapper = mount(UeCropper, {
    attachTo: document.body,
    props: {
      modelValue: false,
      src: options.src ?? '/photo.png',
      fetchImage: options.omitFetcher ? undefined : (options.fetchImage ?? fetchImage),
      t: createTranslator('zh-CN')
    }
  });

  // The dialog loads its image on the closed→open transition, exactly as the host drives it.
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

/** The natural size only exists once the browser has decoded the image — jsdom never does. */
async function decode(width = 800, height = 600) {
  const img = image();
  Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
  // Read before the load event: `scale` recomputes off the stage's rect the moment
  // the natural size lands. A preview half the size of the original.
  stage()!.getBoundingClientRect = () => rect(width / 2, height / 2);

  img!.dispatchEvent(new Event('load'));
  await nextTick();
}

function drag(target: Element | null, dx: number, dy: number, release = true) {
  target?.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }));
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: dx, clientY: dy }));
  if (release) document.dispatchEvent(new MouseEvent('mouseup'));
}

const geometry = () => ({
  left: box()?.style.left,
  top: box()?.style.top,
  width: box()?.style.width,
  height: box()?.style.height
});

beforeEach(() => {
  document.body.innerHTML = '';
  toBlobResult = new Blob(['png'], { type: 'image/png' });
  exported = null;

  fetchImage = vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));

  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    return contextFor(this);
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(toBlobResult);
  });
});

afterEach(() => {
  wrapper.unmount();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ctx.translate.mockClear();
  ctx.rotate.mockClear();
  ctx.scale.mockClear();
  ctx.drawImage.mockClear();
});

describe('loading the source', () => {
  it('loads immediately when it is first mounted open', async () => {
    wrapper = mount(UeCropper, {
      attachTo: document.body,
      props: {
        modelValue: true,
        src: '/photo.png',
        fetchImage,
        t: createTranslator('zh-CN')
      }
    });
    await flushPromises();

    expect(fetchImage).toHaveBeenCalledWith('/photo.png');
    expect(image()?.src).toMatch(/^blob:/);
  });

  it('pulls the bytes through the injected fetcher rather than the network', async () => {
    const network = vi.spyOn(globalThis, 'fetch');

    await open({ src: '/photo.png' });

    expect(fetchImage).toHaveBeenCalledWith('/photo.png');
    expect(network).not.toHaveBeenCalled();
    expect(image()?.src).toMatch(/^blob:/);
  });

  it('falls back to a same-origin fetch when the host injects no fetcher', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ blob: async () => new Blob(['x']) } as Response);

    await open({ omitFetcher: true });

    expect(network).toHaveBeenCalledWith('/photo.png', { credentials: 'same-origin' });
    expect(image()?.src).toMatch(/^blob:/);
  });

  it('shows a placeholder while the bytes are still on their way', async () => {
    let release!: (blob: Blob) => void;
    const pending = new Promise<Blob>((resolve) => (release = resolve));

    await open({ fetchImage: () => pending });
    expect(document.body.querySelector('.ue-crop__loading')).not.toBeNull();
    expect(image()).toBeNull();

    release(new Blob(['jpeg']));
    await flushPromises();

    expect(document.body.querySelector('.ue-crop__loading')).toBeNull();
    expect(image()).not.toBeNull();
  });

  it('crops straight from the URL when the image cannot be fetched', async () => {
    await open({ fetchImage: () => Promise.reject(new Error('cors')) });

    expect(image()?.src).toContain('/photo.png');
  });

  it('ignores a fetch that lands after the dialog moved on to another image', async () => {
    let release!: (blob: Blob) => void;
    const stale = new Promise<Blob>((resolve) => (release = resolve));
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockReturnValueOnce(stale)
      .mockResolvedValue(new Blob(['current'], { type: 'image/png' }));

    await open({ src: '/stale.png', fetchImage: fetcher });
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true, src: '/current.png' });
    await flushPromises();

    const current = image()?.src;
    expect(current).toMatch(/^blob:/);

    release(new Blob(['stale']));
    await flushPromises();

    expect(image()?.src).toBe(current);
  });

  it('ignores a fetch that fails after the dialog moved on to another image', async () => {
    let reject!: (error: Error) => void;
    const stale = new Promise<Blob>((_resolve, fail) => (reject = fail));
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockReturnValueOnce(stale)
      .mockResolvedValue(new Blob(['current'], { type: 'image/png' }));

    await open({ src: '/stale.png', fetchImage: fetcher });
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true, src: '/current.png' });
    await flushPromises();

    const current = image()?.src;

    reject(new Error('cors'));
    await flushPromises();

    // The stale failure must not fall back to *its* src over the live image.
    expect(image()?.src).toBe(current);
  });

  it('revokes the object URL it created when the dialog closes', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await open();
    const url = image()?.src;

    await wrapper.setProps({ modelValue: false });

    expect(revoke).toHaveBeenCalledWith(url);
  });

  it('has nothing to revoke when it never made an object URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await open({ fetchImage: () => Promise.reject(new Error('cors')) });

    await wrapper.setProps({ modelValue: false });

    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('the crop box', () => {
  it('starts as the whole image, scaled down to fit the stage', async () => {
    await open();
    await decode(800, 600);

    expect(geometry()).toEqual({ left: '0px', top: '0px', width: '400px', height: '300px' });
  });

  it('resizes from the south-east corner', async () => {
    await open();
    await decode();

    drag(handle('se'), -100, -75);
    await nextTick();

    expect(geometry()).toEqual({ left: '0px', top: '0px', width: '300px', height: '225px' });
  });

  it('resizes from the north-west corner, moving the origin with it', async () => {
    await open();
    await decode();

    drag(handle('nw'), 100, 50);
    await nextTick();

    expect(geometry()).toEqual({ left: '100px', top: '50px', width: '300px', height: '250px' });
  });

  it('resizes from the north-east corner', async () => {
    await open();
    await decode();

    drag(handle('ne'), -100, 50);
    await nextTick();

    expect(geometry()).toEqual({ left: '0px', top: '50px', width: '300px', height: '250px' });
  });

  it('resizes from the south-west corner', async () => {
    await open();
    await decode();

    drag(handle('sw'), 100, -75);
    await nextTick();

    expect(geometry()).toEqual({ left: '100px', top: '0px', width: '300px', height: '225px' });
  });

  it('refuses to shrink below a grabbable minimum', async () => {
    await open();
    await decode();

    drag(handle('se'), -1000, -1000);
    await nextTick();

    expect(geometry()).toMatchObject({ width: '12px', height: '12px' });
  });

  it('moves the box without resizing it', async () => {
    await open();
    await decode();
    drag(handle('se'), -100, -75);

    drag(box(), 50, 25);
    await nextTick();

    expect(geometry()).toEqual({ left: '50px', top: '25px', width: '300px', height: '225px' });
  });

  it('keeps the box inside the image when it is dragged past the edge', async () => {
    await open();
    await decode();
    drag(handle('se'), -100, -75);

    drag(box(), 1000, 1000);
    await nextTick();

    expect(geometry()).toMatchObject({ left: '100px', top: '75px' });
  });

  it('stops following the pointer once the button is released', async () => {
    await open();
    await decode();

    drag(box(), 0, 0);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200 }));
    await nextTick();

    expect(geometry()).toMatchObject({ left: '0px', top: '0px' });
  });

  it('tracks the pointer in natural pixels when the stage cannot be measured', async () => {
    await open();

    // No stage rect stub: jsdom — and a stage inside a hidden container — measures
    // 0×0, which makes the preview scale 0. The drag has to stay usable anyway.
    const img = image();
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    img!.dispatchEvent(new Event('load'));
    await nextTick();

    drag(handle('se'), -200, -150);
    await nextTick();
    footerButton('确定')?.click();
    await flushPromises();

    expect(exported?.width).toBe(600);
    expect(exported?.height).toBe(450);
  });

  it('strands no drag listeners when the editor is torn down mid-drag', async () => {
    await open();
    await decode();
    const remove = vi.spyOn(document, 'removeEventListener');

    drag(box(), 10, 10, false);
    wrapper.unmount();

    expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });
});

describe('rotate, flip and reset', () => {
  it('turns the preview a quarter turn clockwise', async () => {
    await open();
    await decode();

    tool('顺时针旋转 90°')?.click();
    await nextTick();

    expect(canvas()?.style.transform).toBe('rotate(90deg) scale(1, 1)');
  });

  it('wraps a counter-clockwise turn round to 270 rather than going negative', async () => {
    await open();
    await decode();

    tool('逆时针旋转 90°')?.click();
    await nextTick();

    expect(canvas()?.style.transform).toBe('rotate(270deg) scale(1, 1)');
  });

  it('comes back to square after four turns', async () => {
    await open();
    await decode();

    for (let turn = 0; turn < 4; turn++) tool('顺时针旋转 90°')?.click();
    await nextTick();

    expect(canvas()?.style.transform).toBe('rotate(0deg) scale(1, 1)');
  });

  it('flips the preview horizontally and back', async () => {
    await open();
    await decode();

    tool('水平翻转')?.click();
    await nextTick();
    expect(canvas()?.style.transform).toBe('rotate(0deg) scale(-1, 1)');

    tool('水平翻转')?.click();
    await nextTick();
    expect(canvas()?.style.transform).toBe('rotate(0deg) scale(1, 1)');
  });

  it('flips the preview vertically and back', async () => {
    await open();
    await decode();

    tool('垂直翻转')?.click();
    await nextTick();
    expect(canvas()?.style.transform).toBe('rotate(0deg) scale(1, -1)');

    tool('垂直翻转')?.click();
    await nextTick();
    expect(canvas()?.style.transform).toBe('rotate(0deg) scale(1, 1)');
  });

  it('puts every adjustment back the way it was', async () => {
    await open();
    await decode();

    drag(handle('se'), -100, -75);
    tool('顺时针旋转 90°')?.click();
    tool('水平翻转')?.click();
    tool('垂直翻转')?.click();
    await nextTick();

    tool('重置')?.click();
    await nextTick();

    expect(canvas()?.style.transform).toBe('rotate(0deg) scale(1, 1)');
    expect(geometry()).toEqual({ left: '0px', top: '0px', width: '400px', height: '300px' });
  });
});

describe('exporting', () => {
  it('exports the cropped region at the image’s natural resolution, not the preview’s', async () => {
    await open();
    await decode(800, 600);

    // A 600×450 crop shown as a 300×225 preview.
    drag(handle('se'), -100, -75);
    await nextTick();

    footerButton('确定')?.click();
    await flushPromises();

    expect(exported?.width).toBe(600);
    expect(exported?.height).toBe(450);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      600,
      450,
      -300,
      -225,
      600,
      450
    );

    const blob = wrapper.emitted('confirm')?.[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    // Exported from the fetched bytes, not from the original URL.
    expect(vi.mocked(fetchImage).mock.lastCall?.[0]).toMatch(/^blob:/);
  });

  it('exports from the source URL when confirm beats a re-fetch', async () => {
    let release!: (blob: Blob) => void;
    const fetcher = vi
      .fn<ImageFetcher>()
      .mockResolvedValueOnce(new Blob(['first'], { type: 'image/png' }))
      .mockReturnValueOnce(new Promise<Blob>((resolve) => (release = resolve)))
      .mockResolvedValue(new Blob(['export'], { type: 'image/png' }));

    await open({ src: '/photo.png', fetchImage: fetcher });
    await decode(800, 600);

    // Reopening revokes the object URL and starts a fetch that has not landed yet —
    // but the size decoded last time is still on record, so confirm is live.
    await wrapper.setProps({ modelValue: false });
    await wrapper.setProps({ modelValue: true });
    await nextTick();

    footerButton('确定')?.click();
    await flushPromises();

    expect(fetcher).toHaveBeenNthCalledWith(3, '/photo.png');
    expect(wrapper.emitted('confirm')).toHaveLength(1);

    release(new Blob(['late']));
  });

  it('rasterises the rotation and the flips into the exported pixels', async () => {
    await open();
    await decode(800, 600);

    drag(handle('se'), -100, -75);
    tool('顺时针旋转 90°')?.click();
    tool('水平翻转')?.click();
    await nextTick();

    footerButton('确定')?.click();
    await flushPromises();

    // A quarter turn swaps the exported canvas' axes.
    expect(exported?.width).toBe(450);
    expect(exported?.height).toBe(600);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
    expect(wrapper.emitted('confirm')).toHaveLength(1);
  });

  it('reports a failed export instead of emitting a broken blob', async () => {
    await open();
    await decode();
    toBlobResult = null;

    footerButton('确定')?.click();
    await flushPromises();

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.emitted('error')).toEqual([['图片导出失败，请重试']]);
    // A failed export leaves the dialog open so the author can try again.
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('exports nothing before the image has been decoded', async () => {
    await open();

    footerButton('确定')?.click();
    await flushPromises();

    expect(wrapper.emitted('confirm')).toBeUndefined();
    expect(wrapper.emitted('error')).toBeUndefined();
  });

  it('runs one export at a time, however often the button is pressed', async () => {
    await open();
    await decode();

    footerButton('确定')?.click();
    footerButton('确定')?.click();
    await flushPromises();

    expect(wrapper.emitted('confirm')).toHaveLength(1);
  });

  it('closes without exporting when the author cancels', async () => {
    await open();
    await decode();

    footerButton('取消')?.click();
    await nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    expect(wrapper.emitted('confirm')).toBeUndefined();
  });
});
