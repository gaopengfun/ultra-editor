/**
 * Minimal SSE reader. Both bundled providers speak server-sent events, and
 * pulling this out means neither of them re-implements chunk buffering.
 *
 * Yields the raw `data:` payloads, in order, until the stream ends or the
 * signal aborts.
 */
/** Join the `data:` fields carried by one SSE event block, per the SSE spec. */
function dataPayload(event: string): string | null {
  const data: string[] = [];
  for (const line of event.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const value = line.slice(5);
    data.push(value.startsWith(' ') ? value.slice(1) : value);
  }
  return data.length ? data.join('\n') : null;
}

const MAX_SSE_EVENT_CHARS = 1_000_000;
const MAX_ERROR_DETAIL_CHARS = 300;

export async function* readSSE(response: Response, signal: AbortSignal): AsyncGenerator<string> {
  if (!response.body) throw new Error('ai-no-stream-body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const eventSeparator = /\r?\n\r?\n/g;
  let buffer = '';

  if (signal.aborted) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    return;
  }

  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener('abort', cancel, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line; anything after the last one is a
      // partial event and stays in the buffer for the next read.
      let consumed = 0;
      eventSeparator.lastIndex = 0;
      for (let match = eventSeparator.exec(buffer); match; match = eventSeparator.exec(buffer)) {
        const event = buffer.slice(consumed, match.index);
        consumed = eventSeparator.lastIndex;
        const payload = dataPayload(event);
        if (payload) yield payload;
      }
      if (consumed) buffer = buffer.slice(consumed);
      if (buffer.length > MAX_SSE_EVENT_CHARS) throw new Error('ai-sse-event-too-large');

      if (signal.aborted) break;
    }

    // A lenient server (vLLM, Ollama, a custom proxy) can close the stream right
    // after the last `data:` with no trailing blank line. Flush the decoder and
    // drain what's left, or that final delta — often the last sentence — is lost.
    buffer += decoder.decode();
    if (!signal.aborted) {
      if (buffer.length > MAX_SSE_EVENT_CHARS) throw new Error('ai-sse-event-too-large');
      const payload = dataPayload(buffer);
      if (payload) yield payload;
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

export async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const detail = await readErrorDetail(response);
  throw new Error(`ai-request-failed: ${response.status} ${detail}`);
}

async function readErrorDetail(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let detail = '';
  let done = false;

  try {
    while (detail.length < MAX_ERROR_DETAIL_CHARS) {
      const result = await reader.read();
      if (result.done) {
        done = true;
        break;
      }

      const remaining = MAX_ERROR_DETAIL_CHARS - detail.length;
      const byteBudget = remaining * 4;
      const bytes = result.value.subarray(0, byteBudget);
      detail += decoder.decode(bytes, { stream: true });
      if (result.value.length > byteBudget) break;
    }
    if (done) detail += decoder.decode();
  } catch {
    // The status is still useful when an error body itself cannot be read.
  } finally {
    if (!done) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }

  return detail.slice(0, MAX_ERROR_DETAIL_CHARS);
}
