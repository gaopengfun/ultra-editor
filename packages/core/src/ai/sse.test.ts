import { describe, expect, it } from 'vitest';
import { assertOk, readSSE } from './sse';

const encoder = new TextEncoder();

/** A fake Response whose body streams exactly the given chunks, in order. */
function responseOf(chunks: Array<string | Uint8Array>): Response {
  const bytes = chunks.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of bytes) controller.enqueue(chunk);
      controller.close();
    }
  });
  return { body } as unknown as Response;
}

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of stream) out.push(payload);
  return out;
}

const freshSignal = () => new AbortController().signal;

describe('readSSE', () => {
  it('yields the data payload of each complete event', async () => {
    const out = await collect(readSSE(responseOf(['data: a\n\ndata: b\n\n']), freshSignal()));
    expect(out).toEqual(['a', 'b']);
  });

  it('reassembles an event split across chunk boundaries', async () => {
    // The `data:` line and its terminating blank line arrive in three reads.
    const out = await collect(readSSE(responseOf(['data: hel', 'lo\n', '\n']), freshSignal()));
    expect(out).toEqual(['hello']);
  });

  it('reassembles a multi-byte character split across chunks', async () => {
    // '你' is three UTF-8 bytes; cut the stream in the middle of it. Without the
    // decoder's streaming mode this would surface as replacement characters.
    const full = encoder.encode('data: 你好\n\n');
    const cut = 7; // 'data: ' is six bytes, so this lands inside '你'
    const out = await collect(
      readSSE(responseOf([full.slice(0, cut), full.slice(cut)]), freshSignal())
    );
    expect(out).toEqual(['你好']);
  });

  it('joins multiple data fields into one event payload', async () => {
    const out = await collect(
      readSSE(
        responseOf(['event: message\ndata: first line\ndata: second line\n\n']),
        freshSignal()
      )
    );

    expect(out).toEqual(['first line\nsecond line']);
  });

  it('removes only one optional space after the data field colon', async () => {
    const out = await collect(
      readSSE(responseOf(['data:  leading and trailing  \n\n']), freshSignal())
    );

    expect(out).toEqual([' leading and trailing  ']);
  });

  it('emits the final event even without a trailing blank line', async () => {
    // A lenient server closing right after the last `data:`. Before the flush
    // fix this dropped 'b' entirely.
    const out = await collect(readSSE(responseOf(['data: a\n\ndata: b']), freshSignal()));
    expect(out).toEqual(['a', 'b']);
  });

  it('handles CRLF line and event separators', async () => {
    const out = await collect(
      readSSE(responseOf(['data: a\r\n\r\ndata: b\r\n\r\n']), freshSignal())
    );
    expect(out).toEqual(['a', 'b']);
  });

  it('skips comment lines, non-data fields and empty payloads', async () => {
    const out = await collect(
      readSSE(
        responseOf([': keep-alive\n\nevent: msg\ndata: x\n\ndata:\n\ndata: y\n\n']),
        freshSignal()
      )
    );
    expect(out).toEqual(['x', 'y']);
  });

  it('throws when the response has no body', async () => {
    await expect(
      collect(readSSE({ body: null } as unknown as Response, freshSignal()))
    ).rejects.toThrow('ai-no-stream-body');
  });

  it('rejects an unterminated event that grows beyond the buffer limit', async () => {
    await expect(
      collect(readSSE(responseOf([`data: ${'x'.repeat(1_000_000)}`]), freshSignal()))
    ).rejects.toThrow('ai-sse-event-too-large');
  });

  it('checks the limit again after flushing an incomplete UTF-8 tail', async () => {
    const prefix = encoder.encode(`data: ${'x'.repeat(999_994)}`);
    const bytes = new Uint8Array(prefix.length + 1);
    bytes.set(prefix);
    bytes[prefix.length] = 0xe4;

    await expect(collect(readSSE(responseOf([bytes]), freshSignal()))).rejects.toThrow(
      'ai-sse-event-too-large'
    );
  });

  it('does not count already completed events against the partial-event limit', async () => {
    const payload = 'x'.repeat(600_000);
    const out = await collect(
      readSSE(responseOf([`data: ${payload}\n\ndata: ${payload}\n\n`]), freshSignal())
    );

    expect(out).toEqual([payload, payload]);
  });

  it('closes the body when the consumer stops reading', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\n\ndata: b\n\n'));
        // Left open: the provider walks away before the server is finished, which
        // is what both bundled ones do on `[DONE]` / `message_stop`.
      },
      cancel() {
        cancelled = true;
      }
    });

    for await (const payload of readSSE({ body } as unknown as Response, freshSignal())) {
      expect(payload).toBe('a');
      break;
    }

    // Releasing the lock is not closing the body — without the cancel, every
    // completed generation would leave its response (and connection) hanging.
    expect(cancelled).toBe(true);
  });

  it('closes the body when an oversized event aborts the read', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${'x'.repeat(1_000_000)}`));
      },
      cancel() {
        cancelled = true;
      }
    });

    await expect(collect(readSSE({ body } as unknown as Response, freshSignal()))).rejects.toThrow(
      'ai-sse-event-too-large'
    );

    expect(cancelled).toBe(true);
  });

  it('swallows a body that refuses to close when the consumer stops', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\n\ndata: b\n\n'));
      },
      cancel() {
        throw new Error('cancel-failed');
      }
    });

    // A body that cannot be closed is not the caller's problem, and must not
    // surface as a rejection out of a generator they already walked away from.
    await expect(
      (async () => {
        for await (const payload of readSSE({ body } as unknown as Response, freshSignal())) {
          expect(payload).toBe('a');
          break;
        }
      })()
    ).resolves.toBeUndefined();
  });

  it('leaves a stream that ran dry alone', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\n\n'));
        controller.close();
      },
      cancel() {
        cancelled = true;
      }
    });

    expect(await collect(readSSE({ body } as unknown as Response, freshSignal()))).toEqual(['a']);

    // Nothing left to release; cancelling a finished stream would only be noise.
    expect(cancelled).toBe(false);
  });

  it('cancels immediately when the signal was already aborted', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      }
    });
    const controller = new AbortController();
    controller.abort();

    expect((await readSSE({ body } as unknown as Response, controller.signal).next()).done).toBe(
      true
    );
    expect(cancelled).toBe(true);
  });

  it('swallows a failed cancellation when the signal was already aborted', async () => {
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error('cancel-failed');
      }
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      readSSE({ body } as unknown as Response, controller.signal).next()
    ).resolves.toMatchObject({ done: true });
  });

  it('stops and cancels the reader when aborted mid-stream, dropping the trailing partial', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\n\ndata: b'));
        // Left open on purpose — only the abort ends the stream.
      },
      cancel() {
        cancelled = true;
      }
    });
    const controller = new AbortController();
    const stream = readSSE({ body } as unknown as Response, controller.signal);

    expect((await stream.next()).value).toBe('a');
    controller.abort();
    const next = await stream.next();

    expect(next.done).toBe(true);
    expect(cancelled).toBe(true);
  });

  it('swallows a reader that fails to cancel rather than raising an unhandled rejection', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: a\n\n'));
      },
      cancel() {
        throw new Error('cancel-failed');
      }
    });
    const controller = new AbortController();
    const stream = readSSE({ body } as unknown as Response, controller.signal);

    expect((await stream.next()).value).toBe('a');
    controller.abort();

    expect((await stream.next()).done).toBe(true);
  });
});

describe('assertOk', () => {
  it('resolves for an ok response', async () => {
    await expect(assertOk({ ok: true } as Response)).resolves.toBeUndefined();
  });

  it('throws with the status and a body truncated to 300 chars', async () => {
    const response = new Response('e'.repeat(500), { status: 429 });
    await expect(assertOk(response)).rejects.toThrow(/^ai-request-failed: 429 e{300}$/);
  });

  it('includes a short error body that closes normally', async () => {
    const response = new Response('temporarily unavailable', { status: 503 });
    await expect(assertOk(response)).rejects.toThrow(
      'ai-request-failed: 503 temporarily unavailable'
    );
  });

  it('cancels an error body once enough detail has been read', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('e'.repeat(5000)));
      },
      cancel() {
        cancelled = true;
      }
    });
    const response = { ok: false, status: 413, body } as unknown as Response;

    await expect(assertOk(response)).rejects.toThrow(/^ai-request-failed: 413 e{300}$/);
    expect(cancelled).toBe(true);
  });

  it('still throws when the error body cannot be read', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('no body'));
      }
    });
    const response = { ok: false, status: 500, body } as unknown as Response;
    await expect(assertOk(response)).rejects.toThrow('ai-request-failed: 500');
  });
});
