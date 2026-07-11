import type { AIProvider, AIRequest } from '../ai/types';
import { promptFor, type Prompt } from '../ai/prompts';
import { assertOk, readSSE } from '../ai/sse';

export interface OpenAIProviderOptions {
  /**
   * API key. Leave this out and point `baseURL` at your own backend — shipping a
   * real key to the browser hands it to anyone who opens devtools.
   */
  apiKey?: string;
  /** Defaults to OpenAI. Any OpenAI-compatible endpoint works: DeepSeek, Kimi, Ollama, vLLM. */
  baseURL?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  /** Swap in your own prompt wording without forking the provider. */
  promptFor?: (request: AIRequest) => Prompt;
  /** Injectable for tests and for hosts with a custom fetch (retries, tracing…). */
  fetch?: typeof fetch;
}

interface ChatChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

/**
 * OpenAI-compatible chat completions provider.
 *
 * Works against anything that speaks the `/chat/completions` SSE shape, which
 * in practice is most of the ecosystem — including a thin proxy of your own
 * that keeps the API key on the server where it belongs.
 */
export function createOpenAIProvider(options: OpenAIProviderOptions = {}): AIProvider {
  const {
    apiKey,
    baseURL = 'https://api.openai.com/v1',
    model = 'gpt-4o-mini',
    temperature = 0.7,
    maxTokens,
    headers = {},
    promptFor: buildPrompt = promptFor,
    fetch: fetchImpl = globalThis.fetch
  } = options;

  return {
    async *stream(request, signal) {
      const prompt = buildPrompt(request);

      const response = await fetchImpl(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...headers
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ]
        })
      });

      await assertOk(response);

      for await (const payload of readSSE(response, signal)) {
        if (payload === '[DONE]') return;
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(payload) as ChatChunk;
        } catch {
          // Keep-alive comments and vendor-specific noise — skip rather than die.
          continue;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  };
}
