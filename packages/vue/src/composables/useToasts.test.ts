import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useToasts, type ToastController } from './useToasts';

// Composables that register lifecycle hooks need an owner; an effect scope is the
// cheapest one that still runs `onScopeDispose`.
let scope: ReturnType<typeof effectScope>;
let toasts: ToastController;

beforeEach(() => {
  vi.useFakeTimers();
  scope = effectScope();
  toasts = scope.run(() => useToasts()) as ToastController;
});

afterEach(() => {
  scope.stop();
  vi.useRealTimers();
});

const messages = () => toasts.toasts.value.map((toast) => toast.message);

describe('useToasts', () => {
  it('queues toasts in the order they were shown', () => {
    toasts.info('第一条');
    toasts.success('第二条');

    expect(messages()).toEqual(['第一条', '第二条']);
  });

  it('hands back an id that dismisses that toast and leaves the others alone', () => {
    const first = toasts.info('第一条');
    toasts.info('第二条');

    toasts.dismiss(first);

    expect(messages()).toEqual(['第二条']);
  });

  it('ignores an id that has already been dismissed', () => {
    const id = toasts.info('已关闭');
    toasts.dismiss(id);
    toasts.dismiss(id);

    expect(messages()).toEqual([]);
  });

  it('tags each toast with the kind of the shortcut that raised it', () => {
    toasts.info('提示');
    toasts.success('成功');
    toasts.error('失败');

    expect(toasts.toasts.value.map((toast) => toast.kind)).toEqual(['info', 'success', 'error']);
  });

  it('dismisses a toast on its own once the default duration is up', async () => {
    toasts.show('自动消失');

    await vi.advanceTimersByTimeAsync(2999);
    expect(messages()).toEqual(['自动消失']);

    await vi.advanceTimersByTimeAsync(1);
    expect(messages()).toEqual([]);
  });

  it('honours an explicit duration', async () => {
    toasts.show('很快消失', 'error', 500);

    await vi.advanceTimersByTimeAsync(500);
    expect(messages()).toEqual([]);
  });

  it('keeps a loading notice up until it is dismissed by hand', async () => {
    const id = toasts.loading('上传中…');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(messages()).toEqual(['上传中…']);

    toasts.dismiss(id);
    expect(messages()).toEqual([]);
  });

  it('drops pending timers when the scope is disposed, so none fire into a dead editor', () => {
    toasts.info('还在倒计时');
    expect(vi.getTimerCount()).toBe(1);

    scope.stop();

    expect(vi.getTimerCount()).toBe(0);
  });
});
