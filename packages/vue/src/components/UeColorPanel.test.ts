import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createTranslator } from '@ultra-editor/core';
import UeColorPanel from './UeColorPanel.vue';

let wrapper: VueWrapper;

const t = createTranslator('zh-CN', {});

beforeAll(() => {
  // jsdom implements neither, and the picker steers a drag through both.
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => true;
});

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const panel = () => document.body.querySelector<HTMLElement>('.ue-color-panel');
const swatches = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-swatch'));
const swatch = (color: string) => {
  const found = swatches().find((node) => node.getAttribute('aria-label') === color);
  if (!found) throw new Error(`no swatch for ${color}`);
  return found;
};
const customButton = () => document.body.querySelector<HTMLButtonElement>('.ue-color-custom');
const clearButton = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-color-actions .ue-btn')).at(-1);
const area = () => document.body.querySelector<HTMLElement>('.ue-color-area');
const rail = () => document.body.querySelector<HTMLElement>('.ue-color-hue');
const hexField = () => document.body.querySelector<HTMLInputElement>('.ue-color-hex');
const applyButton = () =>
  document.body.querySelector<HTMLButtonElement>('.ue-color-picker .ue-btn');

/** useFloating binds its listeners a frame late. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function open(props: Record<string, unknown> = {}) {
  wrapper = mount(UeColorPanel, {
    props: {
      visible: false,
      x: 30,
      y: 90,
      modelValue: null,
      label: '文字颜色',
      clearLabel: '清除',
      t,
      ...props
    },
    attachTo: document.body
  });
  await wrapper.setProps({ visible: true });
  await frame();
  return wrapper;
}

/** Open the panel and expand the custom section. */
async function openCustom(props: Record<string, unknown> = {}) {
  await open(props);
  customButton()?.click();
  await wrapper.vm.$nextTick();
}

function press(target: EventTarget, key: string, shiftKey = false) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
}

/** jsdom measures every element as zero-sized; a track has to be given a size. */
function sized(element: HTMLElement, width: number, height: number) {
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height, right: width, bottom: height }) as DOMRect;
  return element;
}

function point(type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

describe('UeColorPanel', () => {
  it('renders nothing while hidden', () => {
    wrapper = mount(UeColorPanel, {
      props: {
        visible: false,
        x: 0,
        y: 0,
        modelValue: null,
        label: '文字颜色',
        clearLabel: '清除',
        t
      },
      attachTo: document.body
    });

    expect(panel()).toBeNull();
  });

  it('teleports a labelled dialog to <body> at the anchor point', async () => {
    await open();

    expect(wrapper.element.contains(panel())).toBe(false);
    expect(panel()?.getAttribute('role')).toBe('dialog');
    expect(panel()?.getAttribute('aria-label')).toBe('文字颜色');
    expect(panel()?.style.left).toBe('30px');
    expect(panel()?.style.top).toBe('90px');
  });

  it('marks itself a flyout so the surface that opened it survives the click', async () => {
    await open();
    expect(panel()?.hasAttribute('data-ue-flyout')).toBe(true);
  });

  it('offers the full palette, each swatch labelled and filled with its own colour', async () => {
    await open();

    expect(swatches()).toHaveLength(24);
    expect(swatch('#dc2626').style.background).toBe('rgb(220, 38, 38)');
    expect(swatches().map((node) => node.getAttribute('aria-label'))).toContain('#51a5dc');
  });

  it('marks the swatch matching the current value, and only that one', async () => {
    await open({ modelValue: '#16a34a' });

    expect(swatches().filter((node) => node.classList.contains('is-active'))).toEqual([
      swatch('#16a34a')
    ]);
  });

  it('marks no swatch when the current value is not one of them', async () => {
    await open({ modelValue: '#123456' });
    expect(swatches().some((node) => node.classList.contains('is-active'))).toBe(false);
  });

  it('marks no swatch when there is no colour set at all', async () => {
    await open({ modelValue: null });
    expect(swatches().some((node) => node.classList.contains('is-active'))).toBe(false);
  });

  it('emits the colour and closes when a swatch is picked', async () => {
    await open();
    swatch('#2563eb').click();

    expect(wrapper.emitted('update:modelValue')).toEqual([['#2563eb']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('emits clear — not a colour — and closes when the clear button is used', async () => {
    await open({ modelValue: '#dc2626' });
    expect(clearButton()?.textContent?.trim()).toBe('清除');

    clearButton()?.click();

    expect(wrapper.emitted('clear')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('keeps the editor selection by preventing mousedown on every control it offers', async () => {
    await open();

    for (const control of [swatch('#dc2626'), customButton()!, clearButton()!]) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('takes focus on open, so the first Escape closes the panel and not its opener', async () => {
    await open();

    expect(document.activeElement).toBe(swatches()[0]);
  });

  it('closes on Escape and on a click outside itself', async () => {
    await open();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(2);
  });
});

describe('UeColorPanel custom colour', () => {
  it('stays out of the way until it is asked for', async () => {
    await open();
    expect(area()).toBeNull();
    expect(customButton()?.getAttribute('aria-expanded')).toBe('false');

    customButton()?.click();
    await wrapper.vm.$nextTick();

    expect(area()).not.toBeNull();
    expect(customButton()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('reopens compact after having been expanded', async () => {
    await openCustom();
    expect(area()).not.toBeNull();

    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    await frame();

    expect(area()).toBeNull();
  });

  it('starts from the colour already set', async () => {
    await openCustom({ modelValue: '#7c3aed' });

    expect(hexField()?.value).toBe('#7c3aed');
    // 262° is where that purple sits on the wheel.
    expect(rail()?.getAttribute('aria-valuenow')).toBe('262');
  });

  it('starts from a usable colour when nothing is set yet', async () => {
    await openCustom({ modelValue: null });

    // Full saturation and value, so the area shows a live gradient rather than
    // the black square a zeroed value would leave behind.
    expect(hexField()?.value).toBe('#ff0000');
  });

  it('starts from a usable colour when the one set cannot be read', async () => {
    // A host may hold a colour this picker has no hex for — a keyword, a gradient.
    await openCustom({ modelValue: 'transparent' });

    expect(hexField()?.value).toBe('#ff0000');
  });

  it('keeps the hue rail where it stands when the colour is a grey', async () => {
    await openCustom({ modelValue: null });
    press(rail()!, 'ArrowRight', true); // move off red, to 30°

    const field = hexField()!;
    field.value = '#808080';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();

    // Grey has no hue in it to read. Snapping the rail back to red would send the
    // author somewhere they never chose the moment they dragged saturation up.
    expect(rail()?.getAttribute('aria-valuenow')).toBe('30');
  });

  it('folds the custom section away again when its toggle is used twice', async () => {
    await openCustom();
    expect(area()).not.toBeNull();

    customButton()?.click();
    await wrapper.vm.$nextTick();

    expect(area()).toBeNull();
    expect(customButton()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('moves the wheel to follow a hex that is typed in', async () => {
    await openCustom();
    const field = hexField()!;

    field.value = '#00ff00';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(rail()?.getAttribute('aria-valuenow')).toBe('120');
  });

  it('leaves a half-typed hex alone rather than rewriting it mid-keystroke', async () => {
    await openCustom();
    const field = hexField()!;

    field.value = '#5b5';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(hexField()?.value).toBe('#5b5');
  });

  it('refuses to apply a hex it cannot read', async () => {
    await openCustom();
    const field = hexField()!;

    field.value = '不是颜色';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(applyButton()?.disabled).toBe(true);
    expect(field.classList.contains('ue-input--error')).toBe(true);

    applyButton()?.click();
    // Enter is not gated by the disabled button, so the guard has to hold here too.
    press(field, 'Enter');

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('emits the colour and closes when it is applied', async () => {
    await openCustom();
    const field = hexField()!;

    field.value = 'ABCDEF';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();
    applyButton()?.click();

    // Normalised on the way out: the document should never hold two spellings
    // of the same colour depending on how it was typed.
    expect(wrapper.emitted('update:modelValue')).toEqual([['#abcdef']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('applies on Enter, so the field can be finished without reaching for the button', async () => {
    await openCustom();
    const field = hexField()!;

    field.value = '#abcdef';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wrapper.vm.$nextTick();
    press(field, 'Enter');

    expect(wrapper.emitted('update:modelValue')).toEqual([['#abcdef']]);
  });

  it('does not touch the document while the colour is only being adjusted', async () => {
    // A drag is dozens of events; emitting each one would bury the author's undo
    // stack under every pixel they passed through on the way to the colour.
    await openCustom();
    sized(area()!, 200, 100).dispatchEvent(point('pointerdown', 100, 25));
    await wrapper.vm.$nextTick();

    expect(hexField()?.value).toBe('#bf6060');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('tracks a drag across the saturation area and along the hue rail', async () => {
    await openCustom();

    const saturation = sized(area()!, 200, 100);
    saturation.dispatchEvent(point('pointerdown', 0, 0));
    saturation.dispatchEvent(point('pointermove', 200, 0));
    await wrapper.vm.$nextTick();
    expect(hexField()?.value).toBe('#ff0000');

    const hue = sized(rail()!, 360, 10);
    hue.dispatchEvent(point('pointerdown', 180, 5));
    await wrapper.vm.$nextTick();
    expect(rail()?.getAttribute('aria-valuenow')).toBe('180');
  });

  it('ignores a pointer crossing the track without having pressed on it', async () => {
    // Hover is not a drag. Without the capture check, moving the mouse across the
    // panel on the way to the clear button would repaint the colour underneath it.
    await openCustom();
    HTMLElement.prototype.hasPointerCapture = () => false;

    sized(area()!, 200, 100).dispatchEvent(point('pointermove', 100, 50));
    sized(rail()!, 360, 10).dispatchEvent(point('pointermove', 180, 5));
    await wrapper.vm.$nextTick();

    HTMLElement.prototype.hasPointerCapture = () => true;
    expect(hexField()?.value).toBe('#ff0000');
    expect(rail()?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('holds still on a track the browser has not measured yet', async () => {
    // Every element is zero-sized until layout runs, and a zero width would divide
    // the drag into a NaN — which reaches the document as a colour of "#NaNNaNNaN".
    await openCustom();

    area()!.dispatchEvent(point('pointerdown', 40, 40));
    await wrapper.vm.$nextTick();

    // Every offset reads as 0 in a zero-wide track, which is the top-left corner
    // of the area: no saturation, full value. A colour, and not a NaN.
    expect(hexField()?.value).toBe('#ffffff');
  });

  it('clamps a drag that leaves the track instead of losing the colour', async () => {
    await openCustom();
    const saturation = sized(area()!, 200, 100);

    saturation.dispatchEvent(point('pointerdown', -50, 500));
    await wrapper.vm.$nextTick();

    // Off the left edge is no saturation, off the bottom is no value: black.
    expect(hexField()?.value).toBe('#000000');
  });

  it('steers saturation and value with the arrow keys', async () => {
    await openCustom();

    press(area()!, 'ArrowLeft');
    await wrapper.vm.$nextTick();
    expect(hexField()?.value).toBe('#ff0505');

    press(area()!, 'ArrowDown');
    await wrapper.vm.$nextTick();
    expect(hexField()?.value).toBe('#fa0505');

    // And back, so neither direction is a one-way trip.
    press(area()!, 'ArrowRight');
    press(area()!, 'ArrowUp');
    await wrapper.vm.$nextTick();
    expect(hexField()?.value).toBe('#ff0000');
  });

  it('stops at the edges of the area rather than running past them', async () => {
    await openCustom();

    press(area()!, 'ArrowRight', true);
    press(area()!, 'ArrowUp', true);
    await wrapper.vm.$nextTick();
    expect(hexField()?.value).toBe('#ff0000');

    for (let step = 0; step < 12; step++) press(area()!, 'ArrowDown', true);
    await wrapper.vm.$nextTick();
    expect(hexField()?.value).toBe('#000000');
  });

  it('steers hue with the arrow keys, wrapping around the wheel', async () => {
    await openCustom();

    press(rail()!, 'ArrowRight');
    await wrapper.vm.$nextTick();
    expect(rail()?.getAttribute('aria-valuenow')).toBe('2');

    // Back past zero: the wheel has no ends, so it comes round rather than stops.
    press(rail()!, 'ArrowLeft');
    press(rail()!, 'ArrowLeft');
    await wrapper.vm.$nextTick();
    expect(rail()?.getAttribute('aria-valuenow')).toBe('358');

    press(rail()!, 'ArrowRight', true);
    await wrapper.vm.$nextTick();
    expect(rail()?.getAttribute('aria-valuenow')).toBe('28');
  });

  it('ignores a key that means nothing to the track it was pressed on', async () => {
    await openCustom();

    press(area()!, 'a');
    press(rail()!, 'ArrowUp');
    await wrapper.vm.$nextTick();

    expect(hexField()?.value).toBe('#ff0000');
    expect(rail()?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps the editor selection by preventing mousedown on the tracks and apply', async () => {
    // Without this the document loses its selection the moment the drag starts,
    // and there is nothing left for the colour to be applied to. The hex field is
    // the exception on purpose — it has to take focus to be typed into, and
    // ProseMirror keeps its selection in state whether or not the DOM has focus.
    await openCustom();

    for (const control of [area()!, rail()!, applyButton()!]) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      control.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });
});
