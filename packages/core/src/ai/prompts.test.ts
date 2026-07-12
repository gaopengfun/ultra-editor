import { describe, expect, it } from 'vitest';
import { SELECTION_TASKS, promptFor } from './prompts';
import type { AIRequest, AITask } from './types';

const ALL_TASKS: AITask[] = [
  'continue',
  'complete',
  'write',
  'improve',
  'translate',
  'summarize',
  'rewrite',
  'expand',
  'shorten',
  'fixGrammar',
  'changeTone',
  'custom'
];

const userFor = (request: AIRequest) => promptFor(request).user;

describe('promptFor', () => {
  it('gives every built-in task its own instruction, all of them carrying the input', () => {
    const users = ALL_TASKS.map((task) => userFor({ task, text: 'hello' }));

    expect(new Set(users).size).toBe(ALL_TASKS.length);
    for (const user of users) expect(user).toContain('hello');
  });

  it('builds continue and complete from the text before the cursor, not the selection', () => {
    for (const task of ['continue', 'complete'] as const) {
      const user = userFor({ task, text: 'the selection', context: 'the text before the cursor' });

      expect(user).toContain('the text before the cursor');
      expect(user).not.toContain('the selection');
    }
  });

  it('falls back to the selection when continue and complete are given no context', () => {
    for (const task of ['continue', 'complete'] as const) {
      expect(userFor({ task, text: 'a lone sentence' })).toContain('a lone sentence');
    }
  });

  it('topics a write from the instruction and names the locale to write in', () => {
    const user = userFor({
      task: 'write',
      text: 'the selection',
      instruction: 'sea otters',
      locale: 'zh-CN'
    });

    expect(user).toContain('Topic: sea otters');
    expect(user).toContain('Write in zh-CN.');
    expect(user).not.toContain('the selection');
  });

  it('topics a write from the text and says nothing about language when neither is given', () => {
    const user = userFor({ task: 'write', text: 'sea otters' });

    expect(user).toContain('Topic: sea otters');
    expect(user).not.toContain('Write in');
  });

  it('translates into the requested language, and into English when none is named', () => {
    expect(userFor({ task: 'translate', text: 'hi', instruction: 'French' })).toContain(
      'into French'
    );
    expect(userFor({ task: 'translate', text: 'hi' })).toContain('into English');
  });

  it('shifts to the requested tone, and to a professional one when none is named', () => {
    expect(userFor({ task: 'changeTone', text: 'hi', instruction: 'playful' })).toContain(
      'a playful tone'
    );
    expect(userFor({ task: 'changeTone', text: 'hi' })).toContain('a professional tone');
  });

  it('makes the custom instruction the prompt, defaulting to a plain rewrite', () => {
    expect(userFor({ task: 'custom', text: 'hi', instruction: 'Turn this into a haiku.' })).toBe(
      'Turn this into a haiku.\n\nhi'
    );
    expect(userFor({ task: 'custom', text: 'hi' })).toBe('Rewrite the following text.\n\nhi');
  });

  it('tells the system prompt the document language only when a locale is set', () => {
    const localised = promptFor({ task: 'improve', text: 'hi', locale: 'zh-CN' });
    const bare = promptFor({ task: 'improve', text: 'hi' });

    expect(localised.system).toContain('The document language is zh-CN.');
    expect(bare.system).not.toContain('document language');
    expect(localised.system.startsWith(bare.system)).toBe(true);
  });

  it('falls back to the custom template for a task it does not know', () => {
    const unknown = { task: 'summarise-as-a-limerick', text: 'hi' } as unknown as AIRequest;

    expect(userFor(unknown)).toBe(userFor({ task: 'custom', text: 'hi' }));
  });
});

describe('SELECTION_TASKS', () => {
  it('lists exactly the tasks that operate on the selection', () => {
    expect([...SELECTION_TASKS].sort()).toEqual([
      'changeTone',
      'custom',
      'expand',
      'fixGrammar',
      'improve',
      'rewrite',
      'shorten',
      'summarize',
      'translate'
    ]);
  });

  it('leaves out the tasks that work from the text before the cursor', () => {
    // continue, complete and write have no selection to read — listing them here
    // would make the menus offer them on a selection they do not use.
    for (const task of ['continue', 'complete', 'write'] as const) {
      expect(SELECTION_TASKS).not.toContain(task);
    }
  });
});
