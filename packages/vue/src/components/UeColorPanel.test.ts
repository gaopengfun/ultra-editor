import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import UeColorPanel from './UeColorPanel.vue';

let wrapper: VueWrapper;

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
const native = () => document.body.querySelector<HTMLInputElement>('.ue-color-native');
const clearButton = () =>
  document.body.querySelector<HTMLButtonElement>('.ue-color-actions .ue-btn');

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
      ...props
    },
    attachTo: document.body
  });
  await wrapper.setProps({ visible: true });
  await frame();
  return wrapper;
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
        clearLabel: '清除'
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

  it('emits the colour and closes when one is chosen from the native picker', async () => {
    await open();
    const input = native();
    if (!input) throw new Error('native colour input is not rendered');

    input.value = '#abcdef';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(wrapper.emitted('update:modelValue')).toEqual([['#abcdef']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('seeds the native picker with the current colour, or black when there is none', async () => {
    await open({ modelValue: null });
    expect(native()?.value).toBe('#000000');

    wrapper.unmount();
    await open({ modelValue: '#7c3aed' });
    expect(native()?.value).toBe('#7c3aed');
  });

  it('emits clear — not a colour — and closes when the clear button is used', async () => {
    await open({ modelValue: '#dc2626' });
    expect(clearButton()?.textContent?.trim()).toBe('清除');

    clearButton()?.click();

    expect(wrapper.emitted('clear')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('keeps the editor selection by preventing mousedown on the swatches and the clear button', async () => {
    await open();

    const onSwatch = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    swatch('#dc2626').dispatchEvent(onSwatch);
    expect(onSwatch.defaultPrevented).toBe(true);

    const onClear = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    clearButton()?.dispatchEvent(onClear);
    expect(onClear.defaultPrevented).toBe(true);
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
