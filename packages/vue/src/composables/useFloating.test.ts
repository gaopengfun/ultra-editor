import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import { useFloating, type FloatingAnchor } from './useFloating';

// jsdom has no layout: every element measures 0×0 unless it is told otherwise.
function surface(width = 200, height = 100) {
  const element = document.createElement('div');
  element.appendChild(document.createElement('button'));
  element.getBoundingClientRect = () =>
    ({ width, height, left: 0, top: 0, right: width, bottom: height }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

function flyout() {
  const element = document.createElement('div');
  element.setAttribute('data-ue-flyout', '');
  element.appendChild(document.createElement('button'));
  document.body.appendChild(element);
  return element;
}

function mountFloating(options: { element?: HTMLElement | null; closeOnScroll?: boolean } = {}) {
  const visible = ref(false);
  const anchor = ref<FloatingAnchor>({ x: 0, y: 0 });
  const close = vi.fn();
  let floating!: ReturnType<typeof useFloating>;

  const wrapper = mount(
    defineComponent({
      setup() {
        floating = useFloating(
          visible,
          anchor,
          close,
          options.closeOnScroll === undefined ? {} : { closeOnScroll: options.closeOnScroll }
        );
        if (options.element !== null) floating.element.value = options.element ?? surface();
        return () => null;
      }
    })
  );

  return { ...floating, visible, anchor, close, wrapper };
}

/** Let the watcher place the surface and the deferred listener binding land. */
async function settle() {
  await nextTick();
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function open(floating: ReturnType<typeof mountFloating>) {
  floating.visible.value = true;
  await settle();
}

const mousedown = (target: EventTarget) =>
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
const press = (target: EventTarget, key: string) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useFloating', () => {
  it('puts the surface at the anchor when it fits there', async () => {
    const floating = mountFloating();
    floating.anchor.value = { x: 100, y: 120 };

    await open(floating);

    expect(floating.position.value).toEqual({ left: 100, top: 120 });
  });

  it('pulls the surface back in when it would run past the right edge', async () => {
    const floating = mountFloating();
    floating.anchor.value = { x: 900, y: 120 };

    await open(floating);

    // 1000 − 200 wide − 8 gap.
    expect(floating.position.value).toEqual({ left: 792, top: 120 });
  });

  it('lifts the surface up when it would run past the bottom edge', async () => {
    const floating = mountFloating();
    floating.anchor.value = { x: 100, y: 750 };

    await open(floating);

    expect(floating.position.value).toEqual({ left: 100, top: 692 });
  });

  it('clamps to the viewport edge when the surface is larger than the viewport', async () => {
    const floating = mountFloating({ element: surface(1400, 900) });
    floating.anchor.value = { x: 100, y: 100 };

    await open(floating);

    expect(floating.position.value).toEqual({ left: 8, top: 8 });
  });

  it('leaves the position at the raw anchor when there is no surface to measure', async () => {
    const floating = mountFloating({ element: null });
    floating.anchor.value = { x: 990, y: 790 };

    await open(floating);
    mousedown(document.body);

    expect(floating.position.value).toEqual({ left: 990, top: 790 });
    expect(floating.close).not.toHaveBeenCalled();
  });

  it('re-places the surface when the anchor moves, but only while it is open', async () => {
    const floating = mountFloating();
    await open(floating);

    floating.anchor.value = { x: 300, y: 300 };
    await settle();
    expect(floating.position.value).toEqual({ left: 300, top: 300 });

    floating.visible.value = false;
    await settle();
    floating.anchor.value = { x: 400, y: 400 };
    await settle();

    expect(floating.position.value).toEqual({ left: 300, top: 300 });
  });

  it('closes on a mousedown outside the surface and stays put on one inside it', async () => {
    const element = surface();
    const floating = mountFloating({ element });
    await open(floating);

    mousedown(element.firstChild as HTMLElement);
    expect(floating.close).not.toHaveBeenCalled();

    mousedown(document.body);
    expect(floating.close).toHaveBeenCalledTimes(1);
  });

  it('ignores a mousedown that comes from a flyout it opened', async () => {
    const floating = mountFloating();
    await open(floating);

    mousedown(flyout().firstChild as HTMLElement);

    expect(floating.close).not.toHaveBeenCalled();
  });

  it('closes on Escape and ignores every other key', async () => {
    const floating = mountFloating();
    await open(floating);

    press(window, 'a');
    expect(floating.close).not.toHaveBeenCalled();

    press(window, 'Escape');
    expect(floating.close).toHaveBeenCalledTimes(1);
  });

  it('lets an Escape inside a flyout close the flyout, not the surface underneath', async () => {
    const floating = mountFloating();
    await open(floating);

    press(flyout().firstChild as HTMLElement, 'Escape');

    expect(floating.close).not.toHaveBeenCalled();
  });

  it('still closes on Escape from inside a surface that is itself a flyout', async () => {
    const element = surface();
    element.setAttribute('data-ue-flyout', '');
    const floating = mountFloating({ element });
    await open(floating);

    press(element.firstChild as HTMLElement, 'Escape');

    expect(floating.close).toHaveBeenCalledTimes(1);
  });

  it('closes on resize, and on scroll unless the caller opted out', async () => {
    const floating = mountFloating();
    await open(floating);

    window.dispatchEvent(new Event('scroll'));
    expect(floating.close).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('resize'));
    expect(floating.close).toHaveBeenCalledTimes(2);
  });

  it('keeps a scroll-anchored surface open while the page scrolls', async () => {
    const floating = mountFloating({ closeOnScroll: false });
    await open(floating);

    window.dispatchEvent(new Event('scroll'));

    expect(floating.close).not.toHaveBeenCalled();
  });

  it('binds its window listeners a frame late, so the opening click cannot close it', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const floating = mountFloating();

    floating.visible.value = true;
    await nextTick();
    expect(add).not.toHaveBeenCalledWith('mousedown', expect.any(Function), true);

    await settle();
    expect(add).toHaveBeenCalledWith('mousedown', expect.any(Function), true);
  });

  it('never binds at all when the surface is hidden again before the frame runs', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const floating = mountFloating();

    floating.visible.value = true;
    await nextTick();
    floating.visible.value = false;
    await settle();

    mousedown(document.body);

    expect(add).not.toHaveBeenCalledWith('mousedown', expect.any(Function), true);
    expect(floating.close).not.toHaveBeenCalled();
  });

  it('drops every window listener when the surface hides', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const floating = mountFloating();
    await open(floating);

    floating.visible.value = false;
    await settle();
    mousedown(document.body);
    window.dispatchEvent(new Event('resize'));

    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(floating.close).not.toHaveBeenCalled();
  });

  // A listener that outlives its component keeps calling close() on a dead surface.
  it('drops every window listener when the component unmounts while still open', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const floating = mountFloating();
    await open(floating);

    floating.wrapper.unmount();
    mousedown(document.body);
    press(window, 'Escape');

    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(floating.close).not.toHaveBeenCalled();
  });
});
