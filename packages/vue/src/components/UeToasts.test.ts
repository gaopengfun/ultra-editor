import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import UeToasts from './UeToasts.vue';
import type { Toast } from '../composables/useToasts';

let wrapper: VueWrapper;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const stack = () => document.body.querySelector('.ue-toasts');
const items = () => Array.from(document.body.querySelectorAll('.ue-toast'));

function open(toasts: Toast[]) {
  wrapper = mount(UeToasts, { props: { toasts }, attachTo: document.body });
  return wrapper;
}

describe('UeToasts', () => {
  it('renders no stack at all while there is nothing to show', () => {
    open([]);
    expect(stack()).toBeNull();
  });

  it('teleports the stack to <body> so it escapes the editor element', () => {
    open([{ id: 1, kind: 'info', message: '上传中…' }]);

    expect(stack()).not.toBeNull();
    expect(wrapper.element.contains(stack())).toBe(false);
  });

  it('announces itself politely instead of interrupting a screen reader', () => {
    open([{ id: 1, kind: 'info', message: '上传中…' }]);

    expect(stack()?.getAttribute('role')).toBe('status');
    expect(stack()?.getAttribute('aria-live')).toBe('polite');
  });

  it('renders one node per toast, in order, tagged with its kind', () => {
    open([
      { id: 1, kind: 'info', message: '上传中…' },
      { id: 2, kind: 'success', message: '上传成功' },
      { id: 3, kind: 'error', message: '上传失败' }
    ]);

    expect(items().map((node) => node.textContent?.trim())).toEqual([
      '上传中…',
      '上传成功',
      '上传失败'
    ]);
    expect(items().map((node) => node.className)).toEqual([
      'ue-toast ue-toast--info',
      'ue-toast ue-toast--success',
      'ue-toast ue-toast--error'
    ]);
  });

  it('drops the whole stack once the last toast is dismissed', async () => {
    open([{ id: 1, kind: 'success', message: '完成' }]);
    expect(items()).toHaveLength(1);

    await wrapper.setProps({ toasts: [] });

    expect(stack()).toBeNull();
  });
});
