import { afterEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createTranslator } from '@ultra-editor/core';
import UePrompt from './UePrompt.vue';
import { usePrompt, type PromptController, type PromptRequest } from '../composables/usePrompt';

let wrapper: VueWrapper;
let controller: PromptController;

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = '';
});

const input = () => document.body.querySelector<HTMLInputElement>('#ue-prompt-input');
const error = () => document.body.querySelector('.ue-field__error');
const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.ue-btn'));
const cancelButton = () => buttons()[0];
const confirmButton = () => buttons()[1];

function render(locale: 'zh-CN' | 'en' = 'zh-CN') {
  controller = usePrompt();
  wrapper = mount(UePrompt, {
    props: { controller, t: createTranslator(locale) },
    attachTo: document.body
  });
}

/**
 * Opens and lets the dialog render and the focus watcher run. The pending promise
 * is handed back boxed, so awaiting the helper never adopts it.
 */
async function open(request: PromptRequest) {
  const settled = controller.open(request);
  await nextTick();
  await nextTick();
  return { settled };
}

async function type(value: string) {
  const field = input();
  if (!field) throw new Error('prompt input is not rendered');
  field.value = value;
  field.dispatchEvent(new Event('input'));
  await nextTick();
}

describe('UePrompt', () => {
  it('stays closed until the controller opens it', () => {
    render();
    expect(document.body.querySelector('.ue-dialog')).toBeNull();
  });

  it('renders the request title, label, placeholder and seeded value', async () => {
    render();
    await open({ title: '插入链接', label: '链接地址', placeholder: 'https://', value: '旧值' });

    expect(document.body.querySelector('.ue-dialog__header span')?.textContent).toBe('插入链接');
    expect(document.body.querySelector('.ue-field__label')?.textContent).toBe('链接地址');
    expect(input()?.placeholder).toBe('https://');
    expect(input()?.value).toBe('旧值');
  });

  it('selects the seeded value on open so the first keystroke replaces it', async () => {
    render();
    await open({ title: '插入链接', value: 'https://old.example.com' });

    expect(input()?.selectionStart).toBe(0);
    expect(input()?.selectionEnd).toBe('https://old.example.com'.length);
  });

  it('resolves with the typed value on confirm and closes', async () => {
    render();
    const { settled } = await open({ title: '插入链接' });

    await type('https://new.example.com');
    confirmButton().click();

    await expect(settled).resolves.toBe('https://new.example.com');
    await nextTick();
    expect(document.body.querySelector('.ue-dialog')).toBeNull();
  });

  it('confirms on Enter without letting the key escape as a submit', async () => {
    render();
    const { settled } = await open({ title: '插入链接' });

    await type('https://enter.example.com');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input()?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await expect(settled).resolves.toBe('https://enter.example.com');
  });

  it('resolves with null on cancel', async () => {
    render();
    const { settled } = await open({ title: '插入链接' });

    cancelButton().click();

    await expect(settled).resolves.toBeNull();
  });

  it('settles the promise when the dialog closes itself on Escape', async () => {
    render();
    const { settled } = await open({ title: '插入链接' });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect(settled).resolves.toBeNull();
    await nextTick();
    expect(document.body.querySelector('.ue-dialog')).toBeNull();
  });

  it('holds the dialog open and shows the message when validation fails, then clears it on edit', async () => {
    render();
    const { settled } = await open({
      title: '插入链接',
      validate: (value) => (value.startsWith('http') ? null : '请输入合法链接')
    });

    await type('nope');
    confirmButton().click();
    await nextTick();

    expect(error()?.textContent).toBe('请输入合法链接');
    expect(input()?.classList.contains('ue-input--error')).toBe(true);
    expect(document.body.querySelector('.ue-dialog')).not.toBeNull();

    // The promise is still live — the user has not answered yet.
    await type('https://ok.example.com');
    expect(error()).toBeNull();
    expect(input()?.classList.contains('ue-input--error')).toBe(false);

    confirmButton().click();
    await expect(settled).resolves.toBe('https://ok.example.com');
  });

  it('localises the confirm and cancel labels through the translator', async () => {
    render('en');
    await open({ title: 'Insert link' });

    expect(buttons().map((button) => button.textContent?.trim())).toEqual(['Cancel', 'Confirm']);
  });
});
