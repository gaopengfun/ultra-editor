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
});

describe('assertOk', () => {
  it('resolves for an ok response', async () => {
    await expect(assertOk({ ok: true } as Response)).resolves.toBeUndefined();
  });

  it('throws with the status and a body truncated to 300 chars', async () => {
    const response = {
      ok: false,
      status: 429,
      text: () => Promise.resolve('e'.repeat(500))
    } as unknown as Response;
    await expect(assertOk(response)).rejects.toThrow(/^ai-request-failed: 429 e{300}$/);
  });

  it('still throws when the error body cannot be read', async () => {
    const response = {
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error('no body'))
    } as unknown as Response;
    await expect(assertOk(response)).rejects.toThrow('ai-request-failed: 500');
  });
});
