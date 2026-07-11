/**
 * Minimal SSE reader. Both bundled providers speak server-sent events, and
 * pulling this out means neither of them re-implements chunk buffering.
 *
 * Yields the raw `data:` payloads, in order, until the stream ends or the
 * signal aborts.
 */
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
      buffer = events.pop() ?? '';

      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload) yield payload;
        }
      }

      if (signal.aborted) break;
    }
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
