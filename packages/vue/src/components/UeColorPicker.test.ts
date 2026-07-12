import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import UeColorPicker from './UeColorPicker.vue';
import UeColorPanel from './UeColorPanel.vue';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const trigger = () => wrapper.get('button.ue-color-trigger');
const chip = () => wrapper.get('.ue-color-trigger__chip');
const panel = () => document.body.querySelector<HTMLElement>('.ue-color-panel');
const swatch = (color: string) =>
  document.body.querySelector<HTMLButtonElement>(`.ue-swatch[aria-label="${color}"]`);

/** useFloating inside the panel binds its listeners a frame late. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function render(props: Record<string, unknown> = {}) {
  wrapper = mount(UeColorPicker, {
    props: { modelValue: null, title: '文字颜色', clearLabel: '清除', ...props },
    attachTo: document.body
  });
  return wrapper;
}

async function openPanel() {
  await trigger().trigger('click');
  await frame();
}

describe('UeColorPicker', () => {
  it('describes itself with the title and keeps the panel shut to begin with', () => {
    render();

    expect(trigger().attributes('title')).toBe('文字颜色');
    expect(trigger().attributes('aria-label')).toBe('文字颜色');
    expect(trigger().attributes('aria-haspopup')).toBe('dialog');
    expect(trigger().attributes('aria-expanded')).toBe('false');
    expect(panel()).toBeNull();
  });

  it('paints the chip with the current colour and leaves it transparent when unset', async () => {
    render({ modelValue: null });
    expect(chip().attributes('style')).toContain('transparent');

    await wrapper.setProps({ modelValue: '#dc2626' });
    expect(chip().attributes('style')).toContain('rgb(220, 38, 38)');
  });

  it('opens the palette on click and reports it as expanded', async () => {
    render();
    await openPanel();

    expect(panel()).not.toBeNull();
    expect(trigger().attributes('aria-expanded')).toBe('true');
  });

  it('closes the palette on a second click of the trigger', async () => {
    render();
    await openPanel();
    await trigger().trigger('click');

    expect(panel()).toBeNull();
    expect(trigger().attributes('aria-expanded')).toBe('false');
  });

  it('anchors the panel just below the trigger', async () => {
    const rect = { left: 120, bottom: 48 } as DOMRect;
    const spy = vi
      .spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(rect);

    render();
    await openPanel();

    expect(wrapper.findComponent(UeColorPanel).props()).toMatchObject({ x: 120, y: 54 });
    spy.mockRestore();
  });

  it('hands the current colour, the title and the clear label down to the panel', async () => {
    render({ modelValue: '#16a34a' });
    await openPanel();

    expect(wrapper.findComponent(UeColorPanel).props()).toMatchObject({
      modelValue: '#16a34a',
      label: '文字颜色',
      clearLabel: '清除'
    });
  });

  it('forwards a picked swatch as update:modelValue and shuts the panel', async () => {
    render();
    await openPanel();

    swatch('#2563eb')?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toEqual([['#2563eb']]);
    expect(panel()).toBeNull();
    expect(trigger().attributes('aria-expanded')).toBe('false');
  });

  it('forwards the clear action and shuts the panel', async () => {
    render({ modelValue: '#dc2626' });
    await openPanel();

    document.body.querySelector<HTMLButtonElement>('.ue-color-actions .ue-btn')?.click();
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('clear')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect(panel()).toBeNull();
  });

  it('shuts the panel when it closes itself on Escape', async () => {
    render();
    await openPanel();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(panel()).toBeNull();
    expect(trigger().attributes('aria-expanded')).toBe('false');
  });

  it('keeps the editor selection by preventing the trigger’s mousedown', () => {
    render();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    trigger().element.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
