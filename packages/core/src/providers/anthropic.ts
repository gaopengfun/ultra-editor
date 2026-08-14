import type { AIProvider, AIRequest } from '../ai/types';
import { promptFor, type Prompt } from '../ai/prompts';
import { assertOk, readSSE } from '../ai/sse';

export interface AnthropicProviderOptions {
  /**
   * API key. As with any browser-side key, prefer proxying through your own
   * backend and leaving this unset.
   */
  apiKey?: string;
  baseURL?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  headers?: Record<string, string>;
  /**
   * Send the header that lets Anthropic's API accept browser origins. Only
   * meaningful when calling the API directly with a key — which you shouldn't
   * be doing in production.
   */
  allowBrowser?: boolean;
  promptFor?: (request: AIRequest) => Prompt;
  fetch?: typeof fetch;
}

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { message?: string };
}

/** Anthropic Messages API provider (streaming). */
export function createAnthropicProvider(options: AnthropicProviderOptions = {}): AIProvider {
  const {
    apiKey,
    baseURL = 'https://api.anthropic.com/v1',
    model = 'claude-sonnet-5',
    maxTokens = 2048,
    temperature,
    headers = {},
    allowBrowser = false,
    promptFor: buildPrompt = promptFor,
    fetch: fetchImpl = globalThis.fetch
  } = options;

  return {
    async *stream(request, signal) {
      const prompt = buildPrompt(request);

      const response = await fetchImpl(`${baseURL.replace(/\/$/, '')}/messages`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
          ...(allowBrowser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}),
          ...headers
        },
        body: JSON.stringify({
          model,
          stream: true,
          max_tokens: maxTokens,
          ...(temperature !== undefined ? { temperature } : {}),
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }]
        })
      });

      await assertOk(response);

      for await (const payload of readSSE(response, signal)) {
        let event: AnthropicEvent;
        try {
          event = JSON.parse(payload) as AnthropicEvent;
        } catch {
          continue;
        }
        if (event.type === 'error') {
          throw new Error(`ai-stream-error: ${event.error?.message ?? 'unknown'}`);
        }
        if (event.type === 'message_stop') return;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          if (event.delta.text) yield event.delta.text;
        }
      }
    }
  };
}
