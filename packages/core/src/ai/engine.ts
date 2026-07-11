import type { AIProvider, AIRequest, AIRunHandlers, AIStatus } from './types';

export class AIAbortError extends Error {
  constructor() {
    super('ai-aborted');
    this.name = 'AIAbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof AIAbortError) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'ai-aborted');
}

export interface AIRun {
  /** Resolves with the full text; rejects only on a real failure, never on abort. */
  readonly done: Promise<string>;
  /** Text accumulated so far. Safe to read mid-stream. */
  readonly text: string;
  readonly status: AIStatus;
  abort(): void;
}

/**
 * Drive one AI task to completion.
 *
 * Aborting is a first-class outcome, not an error: a user who hits stop keeps
 * whatever streamed in so far, so `done` resolves with the partial text instead
 * of rejecting. Only genuine failures reject.
 */
export function runAITask(
  provider: AIProvider,
  request: AIRequest,
  handlers: AIRunHandlers = {}
): AIRun {
  const controller = new AbortController();
  let text = '';
  let status: AIStatus = 'streaming';

  const done = (async () => {
    try {
      for await (const chunk of provider.stream(request, controller.signal)) {
        if (controller.signal.aborted) break;
        if (!chunk) continue;
        text += chunk;
        handlers.onChunk?.(chunk, text);
      }

      if (controller.signal.aborted) {
        status = 'aborted';
        handlers.onAbort?.(text);
        return text;
      }

      status = 'done';
      handlers.onDone?.(text);
      return text;
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        status = 'aborted';
        handlers.onAbort?.(text);
        return text;
      }
      status = 'error';
      const failure = error instanceof Error ? error : new Error(String(error));
      handlers.onError?.(failure);
      throw failure;
    }
  })();

  return {
    done,
    get text() {
      return text;
    },
    get status() {
      return status;
    },
    abort: () => controller.abort()
  };
}

/** Collect a whole stream into a string. Used by tests and non-streaming callers. */
export async function collectAI(
  provider: AIProvider,
  request: AIRequest,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let text = '';
  for await (const chunk of provider.stream(request, controller.signal)) {
    if (controller.signal.aborted) break;
    text += chunk;
  }
  return text;
}
