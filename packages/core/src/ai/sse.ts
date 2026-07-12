/**
 * Minimal SSE reader. Both bundled providers speak server-sent events, and
 * pulling this out means neither of them re-implements chunk buffering.
 *
 * Yields the raw `data:` payloads, in order, until the stream ends or the
 * signal aborts.
 */
/** Yield the `data:` payloads carried by one SSE event block. */
function* dataLines(event: string): Generator<string> {
  for (const line of event.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload) yield payload;
  }
}

export async function* readSSE(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error('ai-no-stream-body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; anything after the last one is a
      // partial event and stays in the buffer for the next read.
      const events = buffer.split(/\r?\n\r?\n/);
      // `split` always yields at least one element, so `pop` cannot come back
      // empty here — the `??` is for the type, not for a case that can happen.
      /* v8 ignore next */
      buffer = events.pop() ?? '';

      for (const event of events) yield* dataLines(event);

      if (signal.aborted) break;
    }

    // A lenient server (vLLM, Ollama, a custom proxy) can close the stream right
    // after the last `data:` with no trailing blank line. Flush the decoder and
    // drain what's left, or that final delta — often the last sentence — is lost.
    buffer += decoder.decode();
    if (!signal.aborted) yield* dataLines(buffer);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const detail = await response.text().catch(() => '');
  throw new Error(`ai-request-failed: ${response.status} ${detail.slice(0, 300)}`);
}
