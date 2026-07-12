import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import UeMenu from './UeMenu.vue';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const ITEMS = `
  <button type="button" class="ue-menu__item">一</button>
  <button type="button" class="ue-menu__item" disabled>二</button>
  <button type="button" class="ue-menu__item">三</button>
`;

const menu = () => document.body.querySelector<HTMLElement>('.ue-menu');
const item = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-menu__item')).find(
    (button) => button.textContent?.trim() === text
  );

/** useFloating binds its listeners a frame late, so open() waits one out. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function open(props: Record<string, unknown> = {}, slot = ITEMS) {
  wrapper = mount(UeMenu, {
    props: { visible: false, x: 40, y: 60, ...props },
    slots: { default: slot },
    attachTo: document.body
  });
  await wrapper.setProps({ visible: true });
  await frame();
  return wrapper;
}

const press = (key: string) =>
  menu()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('UeMenu', () => {
  it('renders nothing while hidden', () => {
    wrapper = mount(UeMenu, {
      props: { visible: false, x: 0, y: 0 },
      slots: { default: ITEMS },
      attachTo: document.body
    });

    expect(menu()).toBeNull();
  });

  it('teleports a labelled menu to <body> at the anchor point', async () => {
    await open({ label: '图片' });

    expect(wrapper.element.contains(menu())).toBe(false);
    expect(menu()?.getAttribute('role')).toBe('menu');
    expect(menu()?.getAttribute('aria-label')).toBe('图片');
    expect(menu()?.style.left).toBe('40px');
    expect(menu()?.style.top).toBe('60px');
  });

  it('applies an extra class so a caller can style one menu differently', async () => {
    await open({ menuClass: 'ue-slash' });
    expect(menu()?.classList.contains('ue-slash')).toBe(true);
  });

  it('swallows the native context menu so a right-click inside it does not open two', async () => {
    await open();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    menu()?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('focuses the first item on open so the menu is operable from the keyboard', async () => {
    await open();
    expect(document.activeElement).toBe(item('一'));
  });

  it('returns focus to whatever opened it when it closes', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    await open();
    expect(document.activeElement).not.toBe(trigger);

    await wrapper.setProps({ visible: false });

    expect(document.activeElement).toBe(trigger);
  });

  it('hijacks no focus on close when it never took any — a menu mounted already open', async () => {
    wrapper = mount(UeMenu, {
      props: { visible: true, x: 0, y: 0 },
      slots: { default: ITEMS },
      attachTo: document.body
    });
    await frame();
    expect(document.activeElement).toBe(document.body);

    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    await wrapper.setProps({ visible: false });

    expect(document.activeElement).toBe(elsewhere);
  });

  it('steps down through the items with ArrowDown, skipping disabled ones', async () => {
    await open();

    press('ArrowDown');
    expect(document.activeElement).toBe(item('三'));
  });

  it('wraps ArrowDown from the last item round to the first', async () => {
    await open();
    item('三')?.focus();

    press('ArrowDown');

    expect(document.activeElement).toBe(item('一'));
  });

  it('wraps ArrowUp from the first item round to the last', async () => {
    await open();

    press('ArrowUp');

    expect(document.activeElement).toBe(item('三'));
  });

  it('jumps to the first item on Home and the last on End', async () => {
    await open();

    press('End');
    expect(document.activeElement).toBe(item('三'));

    press('Home');
    expect(document.activeElement).toBe(item('一'));
  });

  it('takes the arrow keys over from the page so the document does not scroll', async () => {
    await open();

    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      menu()?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('leaves other keys to bubble — Escape is useFloating’s job, not the roving focus’s', async () => {
    await open();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    menu()?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes on Escape and on a click outside itself', async () => {
    await open();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(1);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(wrapper.emitted('close')).toHaveLength(2);
  });

  it('ignores the keyboard entirely when it holds no items', async () => {
    await open({}, '<p class="ue-menu__empty">空</p>');

    expect(() => press('ArrowDown')).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('closes on scroll by default and stays put when the caller opts out', async () => {
    await open();
    window.dispatchEvent(new Event('scroll'));
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();

    await open({ closeOnScroll: false });
    window.dispatchEvent(new Event('scroll'));
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('drops its window listeners on unmount', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    await open();
    wrapper.unmount();

    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    remove.mockRestore();
  });

  // Opening focuses the first item a tick late, by which point a menu that was
  // closed again in the meantime has no element left to search.
  it('survives being torn down before it has finished opening', async () => {
    wrapper = mount(UeMenu, {
      props: { visible: false, x: 40, y: 60 },
      slots: { default: ITEMS },
      attachTo: document.body
    });

    await wrapper.setProps({ visible: true });
    expect(() => wrapper.unmount()).not.toThrow();
  });
});
