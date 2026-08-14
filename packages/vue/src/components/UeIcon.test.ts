import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import UeIcon from './UeIcon.vue';

describe('UeIcon', () => {
  it('draws the named icon body inside the shared 24×24 svg', () => {
    const wrapper = mount(UeIcon, { props: { name: 'bold' } });
    const svg = wrapper.get('svg');

    expect(svg.classes()).toContain('ue-ico');
    expect(svg.attributes('viewBox')).toBe('0 0 24 24');
    expect(
      Array.from(svg.element.querySelectorAll('path')).map((path) => path.getAttribute('d'))
    ).toEqual(['M14 12a4 4 0 0 0 0-8H6v8', 'M15 20a4 4 0 0 0 0-8H6v8Z']);
  });

  it('is hidden from assistive tech — the label always lives on the control around it', () => {
    const wrapper = mount(UeIcon, { props: { name: 'table' } });
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true');
  });

  it('degrades to an empty svg for an unknown name rather than throwing', () => {
    const wrapper = mount(UeIcon, { props: { name: 'no-such-icon' } });

    expect(wrapper.get('svg').element.innerHTML).toBe('');
    expect(wrapper.get('svg').classes()).toContain('ue-ico');
  });

  it('replaces the default class when the caller supplies one', () => {
    const wrapper = mount(UeIcon, { props: { name: 'check', class: 'ue-menu__check' } });
    const svg = wrapper.get('svg');

    expect(svg.classes()).toEqual(['ue-menu__check']);
    expect(svg.element.querySelector('polyline')?.getAttribute('points')).toBe('20 6 9 17 4 12');
  });

  it('swaps the body when the name changes', async () => {
    const wrapper = mount(UeIcon, { props: { name: 'bold' } });
    expect(wrapper.get('svg').element.querySelectorAll('path')).toHaveLength(2);

    await wrapper.setProps({ name: 'italic' });

    expect(wrapper.get('svg').element.querySelectorAll('path')).toHaveLength(0);
    expect(wrapper.get('svg').element.querySelectorAll('line')).toHaveLength(3);
  });
});
