import { describe, expect, it, vi } from 'vitest';
import { AIAbortError, collectAI, isAbortError, runAITask } from './engine';
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

/** Yields what it can, then dies — the shape of a stream cut off mid-flight. */
function dying(chunks: string[], error: unknown): AIProvider {
  return {
    async *stream() {
      for (const chunk of chunks) yield chunk;
      throw error;
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

  it('drops empty chunks instead of announcing them', async () => {
    const onChunk = vi.fn();

    const run = runAITask(provider(['a', '', 'b']), request, { onChunk });

    expect(await run.done).toBe('ab');
    expect(onChunk).toHaveBeenCalledTimes(2);
  });

  it('exposes the text accumulated so far while the stream is still running', async () => {
    const run = runAITask(provider(['a', 'b', 'c'], 10), request);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(run.status).toBe('streaming');
    expect(run.text.length).toBeGreaterThan(0);
    expect(run.text.length).toBeLessThan(3);
    expect(await run.done).toBe('abc');
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

  it('resolves with the partial text when the provider itself throws an abort error', async () => {
    const onAbort = vi.fn();
    const onError = vi.fn();

    const run = runAITask(dying(['par', 'tial'], new AIAbortError()), request, {
      onAbort,
      onError
    });

    await expect(run.done).resolves.toBe('partial');
    expect(run.status).toBe('aborted');
    expect(onAbort).toHaveBeenCalledWith('partial');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reads a failure that lands after the user hit stop as an abort, not an error', async () => {
    // A cancelled fetch usually rejects with a plain TypeError rather than an
    // AbortError, so the signal — not the error — is what settles this.
    let stop = () => {};
    const cut: AIProvider = {
      async *stream() {
        yield 'partial';
        stop();
        throw new TypeError('network connection lost');
      }
    };
    const onAbort = vi.fn();
    const onError = vi.fn();

    const run = runAITask(cut, request, { onAbort, onError });
    stop = () => run.abort();

    await expect(run.done).resolves.toBe('partial');
    expect(run.status).toBe('aborted');
    expect(onAbort).toHaveBeenCalledWith('partial');
    expect(onError).not.toHaveBeenCalled();
  });

  it('resolves an aborted run even with no handlers to tell', async () => {
    const stopped = runAITask(provider(['a', 'b', 'c', 'd'], 10), request);
    await new Promise((resolve) => setTimeout(resolve, 25));
    stopped.abort();

    await expect(stopped.done).resolves.toBe(stopped.text);

    const thrown = runAITask(dying(['a'], new AIAbortError()), request);

    await expect(thrown.done).resolves.toBe('a');
    expect(thrown.status).toBe('aborted');
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

  it('wraps a thrown non-Error so onError always receives an Error', async () => {
    const onError = vi.fn();

    const run = runAITask(dying([], 'kaboom'), request, { onError });

    await expect(run.done).rejects.toThrow('kaboom');
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('rejects a failed run even with no handlers to tell', async () => {
    const run = runAITask(dying([], new Error('boom')), request);

    await expect(run.done).rejects.toThrow('boom');
    expect(run.status).toBe('error');
  });
});

describe('isAbortError', () => {
  it("recognises the engine's own abort error", () => {
    expect(isAbortError(new AIAbortError())).toBe(true);
  });

  it("recognises fetch's DOMException-style AbortError", () => {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('recognises an abort that crossed a boundary and lost its class', () => {
    expect(isAbortError(new Error('ai-aborted'))).toBe(true);
  });

  it('leaves a genuine failure alone', () => {
    expect(isAbortError(new Error('boom'))).toBe(false);
  });

  it('is false for anything that is not an Error, however abort-like it reads', () => {
    expect(isAbortError('ai-aborted')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('collectAI', () => {
  it('concatenates the whole stream into one string', async () => {
    expect(await collectAI(provider(['Hel', 'lo, ', 'world']), request)).toBe('Hello, world');
  });

  it('stops on a caller-owned signal, keeping whatever had already arrived', async () => {
    const controller = new AbortController();
    const cut: AIProvider = {
      async *stream() {
        yield 'kept';
        controller.abort();
        yield 'dropped';
      }
    };

    expect(await collectAI(cut, request, controller.signal)).toBe('kept');
  });

  it('unsubscribes from the caller-owned signal, which outlives the call', async () => {
    // The signal belongs to the caller and is often reused; leaving the listener
    // on would pile up one dead entry per invocation.
    const controller = new AbortController();
    const added = vi.spyOn(controller.signal, 'addEventListener');
    const removed = vi.spyOn(controller.signal, 'removeEventListener');

    await collectAI(provider(['a']), request, controller.signal);

    expect(removed).toHaveBeenCalledWith('abort', added.mock.calls[0][1]);
  });
});
