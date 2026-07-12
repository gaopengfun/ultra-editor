import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import UeGridPicker from './UeGridPicker.vue';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const hint = ({ rows, cols }: { rows: number; cols: number }) => `${rows} × ${cols}`;

const trigger = () => wrapper.get('button.ue-tb-btn');
const panel = () => wrapper.find('.ue-popover__panel');
const cells = () => wrapper.findAll('.ue-grid__cell');
const lit = () =>
  cells()
    .map((cell, index) => (cell.classes().includes('is-on') ? index : -1))
    .filter((index) => index >= 0);
const caption = () => wrapper.get('.ue-grid__label').text();

function render(props: Record<string, unknown> = {}) {
  wrapper = mount(UeGridPicker, {
    props: { icon: 'table', title: '表格', cols: 4, hint, ...props },
    attachTo: document.body
  });
  return wrapper;
}

const hover = (index: number) => cells()[index].trigger('mouseenter');

describe('UeGridPicker', () => {
  it('keeps the panel closed until the trigger is clicked', async () => {
    render();
    expect(panel().exists()).toBe(false);

    await trigger().trigger('click');

    expect(panel().exists()).toBe(true);
    expect(trigger().classes()).toContain('is-active');
  });

  it('closes again on a second click of the trigger', async () => {
    render();
    await trigger().trigger('click');
    await trigger().trigger('click');

    expect(panel().exists()).toBe(false);
    expect(trigger().classes()).not.toContain('is-active');
  });

  it('lays out a single row of cells when no row count is given', async () => {
    render({ cols: 5 });
    await trigger().trigger('click');

    expect(cells()).toHaveLength(5);
    expect(wrapper.get('.ue-grid').attributes('style')).toContain('repeat(5, 16px)');
  });

  it('lays out a rows × cols matrix when both bounds are given', async () => {
    render({ rows: 3, cols: 4 });
    await trigger().trigger('click');

    expect(cells()).toHaveLength(12);
    expect(wrapper.get('.ue-grid').attributes('role')).toBe('grid');
    expect(wrapper.get('.ue-grid').attributes('aria-label')).toBe('表格');
  });

  it('previews an r × c block when the cell at (r, c) is hovered', async () => {
    render({ rows: 3, cols: 4 });
    await trigger().trigger('click');

    // Row 2, column 3 → the zero-based index 6 in a 4-wide grid.
    await hover(6);

    expect(lit()).toEqual([0, 1, 2, 4, 5, 6]);
  });

  it('lights nothing at all until a cell is hovered', async () => {
    render({ rows: 3, cols: 4 });
    await trigger().trigger('click');

    expect(lit()).toEqual([]);
  });

  it('reads out the hovered size and falls back to the title otherwise', async () => {
    render({ rows: 3, cols: 4 });
    await trigger().trigger('click');
    expect(caption()).toBe('表格');

    await hover(6);
    expect(caption()).toBe('2 × 3');

    await panel().trigger('mouseleave');
    expect(caption()).toBe('表格');
    expect(lit()).toEqual([]);
  });

  it('labels every cell with the size it would pick', async () => {
    render({ rows: 2, cols: 2 });
    await trigger().trigger('click');

    expect(cells().map((cell) => cell.attributes('aria-label'))).toEqual([
      '1 × 1',
      '1 × 2',
      '2 × 1',
      '2 × 2'
    ]);
  });

  it('emits the picked dimensions and closes', async () => {
    render({ rows: 3, cols: 4 });
    await trigger().trigger('click');
    await cells()[6].trigger('click');

    expect(wrapper.emitted('pick')).toEqual([[{ rows: 2, cols: 3 }]]);
    expect(panel().exists()).toBe(false);
  });

  it('forgets the previous hover when reopened', async () => {
    render({ rows: 3, cols: 4 });
    await trigger().trigger('click');
    await hover(6);
    await trigger().trigger('click');
    await trigger().trigger('click');

    expect(lit()).toEqual([]);
    expect(caption()).toBe('表格');
  });

  it('keeps the editor selection by preventing mousedown on the trigger and the cells', async () => {
    render();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    trigger().element.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);

    await trigger().trigger('click');
    const cellDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    cells()[0].element.dispatchEvent(cellDown);
    expect(cellDown.defaultPrevented).toBe(true);
  });

  it('refuses to open while disabled, even if a click reaches it anyway', async () => {
    render({ disabled: true });

    expect(trigger().attributes('disabled')).toBeDefined();
    trigger().element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wrapper.vm.$nextTick();

    expect(panel().exists()).toBe(false);
    expect(wrapper.emitted('pick')).toBeUndefined();
  });

  it('closes on a mousedown outside itself but survives one inside the panel', async () => {
    render({ rows: 2, cols: 2 });
    await trigger().trigger('click');

    wrapper.get('.ue-grid').element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(panel().exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(panel().exists()).toBe(false);
  });

  it('stops listening for outside clicks once closed and after unmount', async () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    render();

    await trigger().trigger('click');
    await trigger().trigger('click');
    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function), true);

    remove.mockClear();
    await trigger().trigger('click');
    wrapper.unmount();
    expect(remove).toHaveBeenCalledWith('mousedown', expect.any(Function), true);
    remove.mockRestore();
  });
});
