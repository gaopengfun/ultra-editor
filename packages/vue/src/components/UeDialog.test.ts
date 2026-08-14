import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import UeDialog from './UeDialog.vue';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const dialog = () => document.body.querySelector<HTMLElement>('.ue-dialog');
const panel = () => document.body.querySelector<HTMLElement>('.ue-dialog__panel');
const closeButton = () => document.body.querySelector<HTMLButtonElement>('.ue-dialog__close');

/** Mount closed, then open — the v-model flow every caller uses. */
async function openDialog(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  wrapper = mount(UeDialog, {
    props: { modelValue: false, ...props },
    slots: { default: '<p class="body">正文</p>', ...slots },
    attachTo: document.body
  });
  await wrapper.setProps({ modelValue: true });
  return wrapper;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

describe('UeDialog', () => {
  it('renders nothing until it is opened', () => {
    wrapper = mount(UeDialog, { props: { modelValue: false }, attachTo: document.body });
    expect(dialog()).toBeNull();
  });

  it('teleports a modal dialog to <body> and renders the default slot in its body', async () => {
    await openDialog({ title: '插入链接' });

    expect(dialog()).not.toBeNull();
    expect(wrapper.element.contains(dialog())).toBe(false);
    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(document.body.querySelector('.ue-dialog__body .body')?.textContent).toBe('正文');
  });

  it('labels itself by its title element when a title is given', async () => {
    await openDialog({ title: '插入链接' });

    const id = dialog()?.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)?.textContent).toBe('插入链接');
  });

  it('leaves aria-labelledby off entirely when there is no title', async () => {
    await openDialog();
    expect(dialog()?.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('defaults to a 480px panel and honours an explicit width', async () => {
    await openDialog();
    expect(panel()?.style.getPropertyValue('--ue-dialog-width')).toBe('480px');

    await wrapper.setProps({ width: '420px' });
    expect(panel()?.style.getPropertyValue('--ue-dialog-width')).toBe('420px');
  });

  it('renders no footer unless a footer slot is supplied', async () => {
    await openDialog();
    expect(document.body.querySelector('.ue-dialog__footer')).toBeNull();

    wrapper.unmount();
    await openDialog({}, { footer: '<button class="ok">确定</button>' });
    expect(document.body.querySelector('.ue-dialog__footer .ok')?.textContent).toBe('确定');
  });

  it('closes on the header close button', async () => {
    await openDialog({ title: '甲', closeLabel: '关闭' });
    expect(closeButton()?.getAttribute('aria-label')).toBe('关闭');
    expect(closeButton()?.title).toBe('关闭');
    closeButton()?.click();

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('gives the close icon a default accessible name', async () => {
    await openDialog();
    expect(closeButton()?.getAttribute('aria-label')).toBe('Close');
  });

  it('closes on a backdrop mousedown but ignores one that started inside the panel', async () => {
    await openDialog();

    panel()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();

    dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('closes on Escape from anywhere on the page', async () => {
    await openDialog();
    press('Escape');

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
  });

  it('emits closed and restores focus to whatever opened it', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    await openDialog({ title: '甲' });
    expect(document.activeElement).toBe(closeButton());

    await wrapper.setProps({ modelValue: false });

    expect(wrapper.emitted('closed')).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last control back to the first', async () => {
    await openDialog({}, { default: '<input class="first" /><button class="last">确定</button>' });
    const last = document.body.querySelector<HTMLElement>('.last');
    last?.focus();

    press('Tab');

    expect(document.activeElement).toBe(closeButton());
  });

  it('wraps Shift+Tab from the first control round to the last', async () => {
    await openDialog({}, { default: '<input class="first" /><button class="last">确定</button>' });
    closeButton()?.focus();

    press('Tab', { shiftKey: true });

    expect(document.activeElement).toBe(document.body.querySelector('.last'));
  });

  it('pulls focus back into the panel when Tab is pressed from outside it', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    await openDialog({}, { default: '<button class="last">确定</button>' });

    outside.focus();
    press('Tab');
    expect(document.activeElement).toBe(closeButton());

    outside.focus();
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(document.body.querySelector('.last'));
  });

  it('still traps Tab when the body holds nothing focusable — the close button is always there', async () => {
    await openDialog({}, { default: '<p>纯文本，没有任何可聚焦的控件</p>' });

    // The header close button is the panel's only focusable, so it is both the
    // first and the last: Tab in either direction has to land back on it.
    expect(document.activeElement).toBe(closeButton());

    press('Tab');
    expect(document.activeElement).toBe(closeButton());

    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(closeButton());
  });

  it('lets Tab move naturally between controls in the middle of the panel', async () => {
    await openDialog({}, { default: '<input class="mid" /><button class="last">确定</button>' });
    const mid = document.body.querySelector<HTMLElement>('.mid');
    mid?.focus();

    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
        shiftKey
      });
      window.dispatchEvent(event);

      // Only the two ends of the panel are trapped; the middle is the browser's.
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(mid);
    }
  });

  it('leaves any other key alone', async () => {
    await openDialog({}, { default: '<input class="first" />' });
    const input = document.body.querySelector<HTMLElement>('.first');
    input?.focus();

    press('a');

    expect(document.activeElement).toBe(input);
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('stops listening for keys once closed, so Escape no longer fires', async () => {
    await openDialog();
    await wrapper.setProps({ modelValue: false });

    press('Escape');

    // Only the close that the setProps itself represents — no extra emit.
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });

  it('unbinds its key listener on unmount', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    await openDialog();
    wrapper.unmount();

    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    remove.mockRestore();
  });

  // Opening moves focus into the panel a tick late, by which point a dialog torn
  // down in the meantime has no panel left to focus.
  it('survives being torn down before it has finished opening', async () => {
    wrapper = mount(UeDialog, { props: { modelValue: false }, attachTo: document.body });

    await wrapper.setProps({ modelValue: true });
    expect(() => wrapper.unmount()).not.toThrow();
  });
});
