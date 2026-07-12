import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createTranslator, type ImageAlign } from '@ultra-editor/core';
import UeImageMenu from './UeImageMenu.vue';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const items = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-menu__item'));
const labels = () => items().map((item) => item.textContent?.trim());
const byLabel = (text: string) => {
  const found = items().find((item) => item.textContent?.trim() === text);
  if (!found) throw new Error(`no menu item labelled ${text}`);
  return found;
};

/** useFloating binds a frame late; the menu is only fully live after one. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function open(props: Record<string, unknown> = {}, locale: 'zh-CN' | 'en' = 'zh-CN') {
  wrapper = mount(UeImageMenu, {
    props: {
      visible: false,
      x: 10,
      y: 20,
      align: null as ImageAlign | null,
      hasCaption: false,
      t: createTranslator(locale),
      ...props
    },
    attachTo: document.body
  });
  await wrapper.setProps({ visible: true });
  await frame();
  return wrapper;
}

describe('UeImageMenu', () => {
  it('renders nothing while hidden', () => {
    wrapper = mount(UeImageMenu, {
      props: {
        visible: false,
        x: 0,
        y: 0,
        align: null,
        hasCaption: false,
        t: createTranslator()
      },
      attachTo: document.body
    });

    expect(document.body.querySelector('.ue-menu')).toBeNull();
  });

  it('offers rotate, crop, the three alignments and a caption action, in that order', async () => {
    await open();

    expect(labels()).toEqual([
      '顺时针旋转 90°',
      '逆时针旋转 90°',
      '裁切',
      '左对齐',
      '居中',
      '右对齐',
      '添加图注'
    ]);
    expect(document.body.querySelectorAll('.ue-menu__divider[role=separator]')).toHaveLength(2);
  });

  it('labels the surrounding menu through the translator', async () => {
    await open({}, 'en');

    expect(document.body.querySelector('.ue-menu')?.getAttribute('aria-label')).toBe(
      'Image (right-click to rotate / crop / align / caption)'
    );
    expect(labels()).toContain('Crop');
  });

  it('emits the rotation in degrees and closes itself', async () => {
    await open();

    byLabel('顺时针旋转 90°').click();
    expect(wrapper.emitted('rotate')).toEqual([[90]]);
    expect(wrapper.emitted('close')).toHaveLength(1);

    byLabel('逆时针旋转 90°').click();
    expect(wrapper.emitted('rotate')).toEqual([[90], [-90]]);
    expect(wrapper.emitted('close')).toHaveLength(2);
  });

  it('emits crop and closes', async () => {
    await open();
    byLabel('裁切').click();

    expect(wrapper.emitted('crop')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('emits the chosen alignment and closes', async () => {
    await open();
    byLabel('居中').click();

    expect(wrapper.emitted('align')).toEqual([['center']]);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers the alignments as a radio group with none checked when the image has no align', async () => {
    await open();
    const radios = items().filter((item) => item.getAttribute('role') === 'menuitemradio');

    expect(radios).toHaveLength(3);
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false'
    ]);
    expect(document.body.querySelector('.ue-menu__check')).toBeNull();
  });

  it('checks and ticks only the current alignment', async () => {
    await open({ align: 'right' });
    const radios = items().filter((item) => item.getAttribute('role') === 'menuitemradio');

    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true'
    ]);
    expect(radios.map((radio) => radio.classList.contains('is-active'))).toEqual([
      false,
      false,
      true
    ]);
    expect(byLabel('右对齐').querySelector('.ue-menu__check')).not.toBeNull();
    expect(document.body.querySelectorAll('.ue-menu__check')).toHaveLength(1);
  });

  it('offers to add a caption when there is none and to edit it when there is', async () => {
    await open({ hasCaption: false });
    expect(labels()).toContain('添加图注');
    expect(labels()).not.toContain('编辑图注');

    await wrapper.setProps({ hasCaption: true });
    expect(labels()).toContain('编辑图注');
    expect(labels()).not.toContain('添加图注');
  });

  it('emits caption and closes', async () => {
    await open();
    byLabel('添加图注').click();

    expect(wrapper.emitted('caption')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('forwards the menu’s own close — Escape dismisses it without acting on the image', async () => {
    await open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(wrapper.emitted('rotate')).toBeUndefined();
    expect(wrapper.emitted('align')).toBeUndefined();
  });
});
