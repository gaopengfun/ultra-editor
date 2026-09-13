import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createTranslator, type SlashItem } from '@ultra-editor/core';
import UeSlashMenu from './UeSlashMenu.vue';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** jsdom has no layout, so the palette measures 0×0 until it is told otherwise. */
function measuring(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height
  } as DOMRect);
}

const ITEMS = [
  { key: 'h1', group: 'basic', labelKey: 'toolbar.h1', icon: 'h1', run: () => {} },
  { key: 'quote', group: 'basic', labelKey: 'toolbar.blockquote', icon: 'quote', run: () => {} },
  { key: 'table', group: 'insert', labelKey: 'toolbar.table', icon: 'table', run: () => {} },
  { key: 'continue', group: 'ai', labelKey: 'ai.continue', icon: 'ai', run: () => {} }
] as unknown as SlashItem[];

const menu = () => document.body.querySelector<HTMLElement>('.ue-slash');
const options = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role=option]'));
const groups = () =>
  Array.from(document.body.querySelectorAll('.ue-menu__group')).map((node) =>
    node.textContent?.trim()
  );

function render(props: Partial<Record<string, unknown>> = {}, locale: 'zh-CN' | 'en' = 'zh-CN') {
  wrapper = mount(UeSlashMenu, {
    props: {
      visible: true,
      x: 12,
      y: 34,
      items: ITEMS,
      index: 0,
      t: createTranslator(locale),
      ...props
    },
    attachTo: document.body
  });
  return wrapper;
}

describe('UeSlashMenu', () => {
  it('renders nothing while hidden', () => {
    render({ visible: false });
    expect(menu()).toBeNull();
  });

  it('teleports a listbox to <body> at the caret anchor', () => {
    render();

    expect(wrapper.element.contains(menu())).toBe(false);
    expect(menu()?.getAttribute('role')).toBe('listbox');
    expect(menu()?.style.left).toBe('12px');
    expect(menu()?.style.top).toBe('34px');
  });

  // The palette grows with the number of commands — with an AI provider wired up
  // it is tall enough that a caret in the lower half of the window would push the
  // AI group off the bottom, where it cannot be clicked or scrolled to.
  it('lifts the palette back inside the viewport when the caret sits near the bottom', async () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 861);
    measuring(273, 478);

    render({ x: 41, y: 467 });
    await nextTick();
    await nextTick();

    // 861 − 478 tall − 8 gap.
    expect(menu()?.style.top).toBe('375px');
    expect(menu()?.style.left).toBe('41px');
  });

  it('pulls the palette off the right edge when the caret is near it', async () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 861);
    measuring(273, 200);

    render({ x: 900, y: 100 });
    await nextTick();
    await nextTick();

    // 1000 − 273 wide − 8 gap.
    expect(menu()?.style.left).toBe('719px');
    expect(menu()?.style.top).toBe('100px');
  });

  // The editor can be torn down with the palette still open — between drawing it
  // at the caret and measuring it there is a tick in which it can go away.
  it('gives up placing the palette if it is torn down before it can be measured', async () => {
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 861);
    measuring(273, 478);

    render({ x: 41, y: 467 });
    wrapper.unmount();
    await nextTick();
    await nextTick();

    expect(menu()).toBeNull();
  });

  it('keeps the order it is given and heads each run of items with its group', () => {
    render();

    expect(options().map((option) => option.textContent?.trim())).toEqual([
      '标题 1',
      '引用',
      '表格',
      '续写'
    ]);
    expect(groups()).toEqual(['基础', '插入', 'AI']);
  });

  it('opens only one header per group, not one per item', () => {
    render();
    // 'h1' and 'quote' are both basic; the second must not repeat the header.
    expect(groups().filter((label) => label === '基础')).toHaveLength(1);
  });

  it('draws every label and header through the translator', () => {
    render({}, 'en');

    expect(options().map((option) => option.textContent?.trim())).toEqual([
      'Heading 1',
      'Blockquote',
      'Table',
      'Continue writing'
    ]);
    expect(groups()).toEqual(['Basic', 'Insert', 'AI']);
  });

  it('marks the item at `index` as the selected option and no other', () => {
    render({ index: 2 });

    expect(options().map((option) => option.getAttribute('aria-selected'))).toEqual([
      'false',
      'false',
      'true',
      'false'
    ]);
    expect(options().map((option) => option.classList.contains('is-highlighted'))).toEqual([
      false,
      false,
      true,
      false
    ]);
  });

  it('moves the highlight when the parent advances the index', async () => {
    render({ index: 0 });
    await wrapper.setProps({ index: 3 });

    expect(options()[3].getAttribute('aria-selected')).toBe('true');
    expect(options()[0].getAttribute('aria-selected')).toBe('false');
  });

  it('emits select with the whole item — not its position — when one is clicked', () => {
    render();
    options()[2].click();

    expect(wrapper.emitted('select')).toEqual([[ITEMS[2]]]);
  });

  it('emits hover with the row index so the parent can follow the pointer', async () => {
    render();
    options()[1].dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));

    expect(wrapper.emitted('hover')).toEqual([[1]]);
  });

  it('keeps the editor selection alive by preventing the mousedown default', () => {
    render();
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    options()[0].dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('renders each item’s icon', () => {
    render();
    expect(document.body.querySelectorAll('.ue-menu__item svg.ue-ico')).toHaveLength(4);
  });

  it('says so, rather than showing an empty box, when the query matches nothing', () => {
    render({ items: [] });

    expect(document.body.querySelector('.ue-menu__empty')?.textContent).toBe('没有匹配的命令');
    expect(options()).toHaveLength(0);
    expect(groups()).toHaveLength(0);
  });

  it('drops the empty notice as soon as items arrive', async () => {
    render({ items: [] });
    await wrapper.setProps({ items: ITEMS });

    expect(document.body.querySelector('.ue-menu__empty')).toBeNull();
    expect(options()).toHaveLength(4);
  });
});
