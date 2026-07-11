import { describe, expect, it, vi } from 'vitest';
import { runAITask } from './engine';
import type { AIProvider } from './types';

function provider(chunks: string[], delay = 0): AIProvider {
  return {
    async *stream(_request, signal) {
      for (const chunk of chunks) {
        if (signal.aborted) return;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        yield chunk;
      }
    }
  };
}

const request = { task: 'improve', text: 'hello' } as const;

describe('runAITask', () => {
  it('accumulates chunks and reports the whole text', async () => {
    const onChunk = vi.fn();
    const onDone = vi.fn();

    const run = runAITask(provider(['Hel', 'lo, ', 'world']), request, { onChunk, onDone });
    const text = await run.done;

    expect(text).toBe('Hello, world');
    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onChunk).toHaveBeenLastCalledWith('world', 'Hello, world');
    expect(onDone).toHaveBeenCalledWith('Hello, world');
    expect(run.status).toBe('done');
  });

  it('treats an abort as a result, not a failure — the partial text survives', async () => {
    const onAbort = vi.fn();
    const onDone = vi.fn();

    const run = runAITask(provider(['a', 'b', 'c', 'd'], 10), request, { onAbort, onDone });
    await new Promise((resolve) => setTimeout(resolve, 25));
    run.abort();

    const text = await run.done;

    expect(run.status).toBe('aborted');
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThan(4);
    expect(onAbort).toHaveBeenCalledWith(text);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('surfaces provider failures through onError and rejects', async () => {
    const failing: AIProvider = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('boom');
      }
    };
    const onError = vi.fn();

    const run = runAITask(failing, request, { onError });

    await expect(run.done).rejects.toThrow('boom');
    expect(run.status).toBe('error');
    expect(onError).toHaveBeenCalled();
  });
});
