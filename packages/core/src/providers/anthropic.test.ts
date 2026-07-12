import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from './anthropic';
import type { AIRequest } from '../ai/types';

const encoder = new TextEncoder();
const request: AIRequest = { task: 'improve', text: 'hello' };
const signal = () => new AbortController().signal;

/** An ok Response whose body streams the given SSE text. */
function sseResponse(sse: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    }
  });
  return { ok: true, body } as unknown as Response;
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

function textDelta(text: string): string {
  return `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`;
}

const event = (type: string) => `data: ${JSON.stringify({ type })}\n\n`;
const STOP = event('message_stop');

describe('createAnthropicProvider', () => {
  it('yields text deltas and stops at message_stop', async () => {
    const fetch = () =>
      Promise.resolve(sseResponse(textDelta('Hel') + textDelta('lo') + STOP + textDelta('after')));
    const provider = createAnthropicProvider({ fetch, apiKey: 'k' });
    expect(await collect(provider.stream(request, signal()))).toEqual(['Hel', 'lo']);
  });

  it('ignores non-text events (message_start, ping, content_block_start…)', async () => {
    const fetch = () =>
      Promise.resolve(sseResponse(event('message_start') + textDelta('a') + event('ping') + STOP));
    const provider = createAnthropicProvider({ fetch });
    expect(await collect(provider.stream(request, signal()))).toEqual(['a']);
  });

  it('skips non-JSON data lines instead of dying', async () => {
    const fetch = () =>
      Promise.resolve(sseResponse(textDelta('a') + 'data: not-json\n\n' + textDelta('b') + STOP));
    const provider = createAnthropicProvider({ fetch });
    expect(await collect(provider.stream(request, signal()))).toEqual(['a', 'b']);
  });

  it('sends key and version headers, opting into browser access only when asked', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetch = ((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(sseResponse(STOP));
    }) as unknown as typeof globalThis.fetch;

    const provider = createAnthropicProvider({
      fetch,
      apiKey: 'secret',
      baseURL: 'https://proxy.test/v1',
      allowBrowser: true,
      model: 'claude-x'
    });
    await collect(provider.stream(request, signal()));

    expect(captured?.url).toBe('https://proxy.test/v1/messages');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(captured?.init.body as string);
    expect(body.model).toBe('claude-x');
    expect(body.system).toContain('writing assistant');
    expect(body.messages[0].content).toContain('hello');
  });

  it('omits the browser-access header by default', async () => {
    let headers: Record<string, string> = {};
    const fetch = ((_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return Promise.resolve(sseResponse(STOP));
    }) as unknown as typeof globalThis.fetch;
    const provider = createAnthropicProvider({ fetch });
    await collect(provider.stream(request, signal()));
    expect(headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('throws on a non-ok response', async () => {
    const fetch = () =>
      Promise.resolve({
        ok: false,
        status: 529,
        text: () => Promise.resolve('overloaded')
      } as unknown as Response);
    const provider = createAnthropicProvider({ fetch });
    await expect(collect(provider.stream(request, signal()))).rejects.toThrow(
      'ai-request-failed: 529'
    );
  });
});
