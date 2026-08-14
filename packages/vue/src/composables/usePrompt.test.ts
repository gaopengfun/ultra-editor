import { beforeEach, describe, expect, it } from 'vitest';
import { usePrompt, type PromptController } from './usePrompt';

let prompt: PromptController;

beforeEach(() => {
  prompt = usePrompt();
});

describe('usePrompt', () => {
  it('opens with the request filled in and resolves with the entered text on confirm', async () => {
    const answer = prompt.open({
      title: '插入链接',
      label: '地址',
      placeholder: 'https://',
      value: 'https://old.example'
    });

    expect(prompt.state.visible).toBe(true);
    expect(prompt.state.title).toBe('插入链接');
    expect(prompt.state.label).toBe('地址');
    expect(prompt.state.placeholder).toBe('https://');
    expect(prompt.state.input).toBe('https://old.example');

    prompt.state.input = 'https://new.example';
    prompt.confirm();

    await expect(answer).resolves.toBe('https://new.example');
    expect(prompt.state.visible).toBe(false);
  });

  it('starts from an empty field when the request carries no defaults', () => {
    void prompt.open({ title: '插入链接' });

    expect(prompt.state.label).toBe('');
    expect(prompt.state.placeholder).toBe('');
    expect(prompt.state.input).toBe('');
    expect(prompt.state.error).toBeNull();
  });

  it('resolves with null when the user cancels', async () => {
    const answer = prompt.open({ title: '插入链接' });

    prompt.cancel();

    await expect(answer).resolves.toBeNull();
    expect(prompt.state.visible).toBe(false);
  });

  it('keeps the dialog open and shows the reason when validation rejects the input', async () => {
    const answer = prompt.open({
      title: '插入链接',
      validate: (value) => (value.startsWith('http') ? null : '请输入合法链接')
    });

    prompt.state.input = 'ftp://nope';
    prompt.confirm();

    expect(prompt.state.visible).toBe(true);
    expect(prompt.state.error).toBe('请输入合法链接');

    prompt.state.input = 'https://ok.example';
    prompt.confirm();

    await expect(answer).resolves.toBe('https://ok.example');
  });

  it('resolves the pending request with null when a second prompt takes its place', async () => {
    const first = prompt.open({ title: '第一个' });
    const second = prompt.open({ title: '第二个' });

    await expect(first).resolves.toBeNull();
    expect(prompt.state.visible).toBe(true);
    expect(prompt.state.title).toBe('第二个');

    prompt.confirm();
    await expect(second).resolves.toBe('');
  });

  it('ignores a second cancel once the dialog has settled', async () => {
    const answer = prompt.open({ title: '插入链接' });

    prompt.cancel();
    expect(() => prompt.cancel()).not.toThrow();

    await expect(answer).resolves.toBeNull();
  });
});
