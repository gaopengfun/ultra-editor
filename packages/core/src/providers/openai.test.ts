import { describe, expect, it } from 'vitest';
import { createOpenAIProvider } from './openai';
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

/** One `chat.completions` streaming chunk carrying a content delta. */
function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const DONE = 'data: [DONE]\n\n';

describe('createOpenAIProvider', () => {
  it('yields content deltas and stops at [DONE]', async () => {
    const fetch = () =>
      Promise.resolve(sseResponse(delta('Hel') + delta('lo') + DONE + delta('after')));
    const provider = createOpenAIProvider({ fetch, apiKey: 'k' });
    expect(await collect(provider.stream(request, signal()))).toEqual(['Hel', 'lo']);
  });

  it('skips keep-alive comments and non-JSON data lines instead of dying', async () => {
    const fetch = () =>
      Promise.resolve(sseResponse(delta('a') + 'data: not-json\n\n' + delta('b') + DONE));
    const provider = createOpenAIProvider({ fetch });
    expect(await collect(provider.stream(request, signal()))).toEqual(['a', 'b']);
  });

  it('ignores deltas that carry no content (e.g. the opening role delta)', async () => {
    const roleOnly = `data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`;
    const fetch = () => Promise.resolve(sseResponse(roleOnly + delta('a') + DONE));
    const provider = createOpenAIProvider({ fetch });
    expect(await collect(provider.stream(request, signal()))).toEqual(['a']);
  });

  it('builds the endpoint, headers and body from options and the prompt', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetch = ((url: string, init: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(sseResponse(DONE));
    }) as unknown as typeof globalThis.fetch;

    const provider = createOpenAIProvider({
      fetch,
      apiKey: 'secret',
      baseURL: 'https://proxy.test/v1/',
      model: 'gpt-x'
    });
    await collect(provider.stream(request, signal()));

    expect(captured?.url).toBe('https://proxy.test/v1/chat/completions');
    expect(captured?.init.method).toBe('POST');
    const headers = captured?.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret');
    const body = JSON.parse(captured?.init.body as string);
    expect(body.model).toBe('gpt-x');
    expect(body.stream).toBe(true);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].content).toContain('hello');
  });

  it('omits the Authorization header when no key is set', async () => {
    let headers: Record<string, string> = {};
    const fetch = ((_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return Promise.resolve(sseResponse(DONE));
    }) as unknown as typeof globalThis.fetch;
    const provider = createOpenAIProvider({ fetch });
    await collect(provider.stream(request, signal()));
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws on a non-ok response', async () => {
    const fetch = () =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve('nope')
      } as unknown as Response);
    const provider = createOpenAIProvider({ fetch });
    await expect(collect(provider.stream(request, signal()))).rejects.toThrow(
      'ai-request-failed: 401'
    );
  });
});
