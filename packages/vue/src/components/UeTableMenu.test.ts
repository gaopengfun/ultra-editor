import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createTranslator } from '@ultra-editor/core';
import UeTableMenu from './UeTableMenu.vue';
import type { TableAction } from '../types';

type Props = {
  visible?: boolean;
  canMerge?: boolean;
  canSplit?: boolean;
  cellColor?: string | null;
};

let wrapper: VueWrapper;

/**
 * Mount closed, then open — which is how the host drives it. The menu places
 * itself on the closed→open transition, so a component mounted already-open never
 * gets positioned at all.
 */
async function mountMenu(props: Props = {}) {
  wrapper = mount(UeTableMenu, {
    attachTo: document.body,
    props: {
      visible: false,
      x: 40,
      y: 60,
      canMerge: props.canMerge ?? false,
      canSplit: props.canSplit ?? false,
      cellColor: props.cellColor ?? null,
      t: createTranslator('zh-CN')
    }
  });
  if (props.visible !== false) {
    await wrapper.setProps({ visible: true });
    await nextTick();
  }
  return wrapper;
}

/** The menu is teleported to <body>, so it never lives inside `wrapper.element`. */
const menu = () => document.body.querySelector<HTMLElement>('.ue-menu');
const items = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-menu .ue-menu__item'));
const item = (label: string) =>
  items().find((entry) => entry.querySelector('.ue-menu__label')?.textContent === label);
const panel = () => document.body.querySelector<HTMLElement>('.ue-color-panel');

/** `useFloating` binds its listeners one animation frame after the surface opens. */
const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  wrapper.unmount();
});

describe('visibility', () => {
  it('renders nothing at all until the host opens it on a cell', async () => {
    await mountMenu({ visible: false });
    expect(menu()).toBeNull();
  });

  it('opens at the point the host anchored it to', async () => {
    await mountMenu();
    expect(menu()?.style.left).toBe('40px');
    expect(menu()?.style.top).toBe('60px');
  });
});

describe('dismissal', () => {
  it('asks to be closed when the author clicks away from it', async () => {
    await mountMenu();
    await raf();

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('asks to be closed on Escape', async () => {
    await mountMenu();
    await raf();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();

    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

describe('actions', () => {
  const ACTIONS: Array<{ label: string; action: TableAction }> = [
    { label: '上方插入行', action: 'rowBefore' },
    { label: '下方插入行', action: 'rowAfter' },
    { label: '左侧插入列', action: 'colBefore' },
    { label: '右侧插入列', action: 'colAfter' },
    { label: '切换标题行', action: 'headerRow' },
    { label: '切换标题列', action: 'headerCol' },
    { label: '删除本行', action: 'delRow' },
    { label: '删除本列', action: 'delCol' },
    { label: '删除表格', action: 'delTable' }
  ];

  it.each(ACTIONS)('asks the host for $action and closes itself', async ({ label, action }) => {
    await mountMenu();

    item(label)?.click();
    await nextTick();

    expect(wrapper.emitted('action')).toEqual([[action]]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('marks the destructive entries so they cannot be mistaken for the rest', async () => {
    await mountMenu();

    const danger = items()
      .filter((entry) => entry.classList.contains('ue-menu__item--danger'))
      .map((entry) => entry.querySelector('.ue-menu__label')?.textContent);

    expect(danger).toEqual(['删除本行', '删除本列', '删除表格']);
  });
});

describe('merge and split', () => {
  it('offers merge only when the selection actually spans cells', async () => {
    await mountMenu({ canMerge: false });
    expect(item('合并单元格')?.disabled).toBe(true);

    await wrapper.setProps({ canMerge: true });
    expect(item('合并单元格')?.disabled).toBe(false);

    item('合并单元格')?.click();
    await nextTick();

    expect(wrapper.emitted('action')).toEqual([['merge']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers split only when the cell was merged', async () => {
    await mountMenu({ canSplit: false });
    expect(item('拆分单元格')?.disabled).toBe(true);

    await wrapper.setProps({ canSplit: true });
    expect(item('拆分单元格')?.disabled).toBe(false);

    item('拆分单元格')?.click();
    await nextTick();

    expect(wrapper.emitted('action')).toEqual([['split']]);
  });
});

describe('cell colour', () => {
  /** Hangs the flyout off the menu's right edge — jsdom reports every rect as 0×0. */
  function stubGeometry() {
    const rect = (box: { left: number; top: number; right: number; bottom: number }) =>
      ({
        ...box,
        width: box.right - box.left,
        height: box.bottom - box.top,
        x: box.left,
        y: box.top,
        toJSON: () => ({})
      }) as DOMRect;

    const surface = menu();
    const row = item('单元格底色');
    surface!.getBoundingClientRect = () => rect({ left: 40, top: 60, right: 260, bottom: 400 });
    row!.getBoundingClientRect = () => rect({ left: 48, top: 300, right: 252, bottom: 330 });
    return row!;
  }

  it('shows an empty chip until the cell has a background', async () => {
    await mountMenu({ cellColor: null });
    expect(document.body.querySelector('.ue-menu__chip')?.classList).toContain(
      'ue-menu__chip--none'
    );

    await wrapper.setProps({ cellColor: '#dc2626' });

    const chip = document.body.querySelector<HTMLElement>('.ue-menu__chip');
    expect(chip?.classList.contains('ue-menu__chip--none')).toBe(false);
    expect(chip?.style.background).toBe('rgb(220, 38, 38)');
  });

  it('hangs the palette off the menu’s right edge rather than the row’s', async () => {
    await mountMenu();
    const row = stubGeometry();

    row.click();
    await nextTick();

    expect(panel()).not.toBeNull();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    // Menu right edge + 6, row top - 6.
    expect(panel()?.style.left).toBe('266px');
    expect(panel()?.style.top).toBe('294px');
  });

  it('opens the palette from the keyboard as well as the pointer', async () => {
    await mountMenu();
    const row = stubGeometry();

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await nextTick();

    expect(panel()).not.toBeNull();
  });

  it('sends the picked swatch to the host and closes', async () => {
    await mountMenu();
    stubGeometry().click();
    await nextTick();

    panel()?.querySelector<HTMLButtonElement>('.ue-swatch[aria-label="#16a34a"]')?.click();
    await nextTick();

    expect(wrapper.emitted('set-color')).toEqual([['#16a34a']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('sends a clear request to the host and closes', async () => {
    await mountMenu({ cellColor: '#16a34a' });
    stubGeometry().click();
    await nextTick();

    const clear = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.ue-color-actions .ue-btn')
    ).find((element) => element.textContent?.trim() === '清除底色');
    clear?.click();
    await nextTick();

    expect(wrapper.emitted('clear-color')).toHaveLength(1);
    expect(wrapper.emitted('set-color')).toBeUndefined();
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes the palette with the menu, so no flyout is left behind', async () => {
    await mountMenu();
    stubGeometry().click();
    await nextTick();
    expect(panel()).not.toBeNull();

    await wrapper.setProps({ visible: false });

    expect(panel()).toBeNull();
    expect(menu()).toBeNull();
  });

  it('leaves the menu standing when Escape dismisses only the palette', async () => {
    await mountMenu();
    const row = stubGeometry();
    row.click();
    await nextTick();
    await raf();

    panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();

    expect(panel()).toBeNull();
    expect(menu()).not.toBeNull();
    // Focus goes back to the row that opened it, not to the top of the menu.
    expect(document.activeElement).toBe(row);
  });
});
