export type AITask =
  | 'continue'
  | 'improve'
  | 'translate'
  | 'summarize'
  | 'rewrite'
  | 'expand'
  | 'shorten'
  | 'fixGrammar'
  | 'changeTone'
  | 'complete'
  | 'write'
  | 'custom';

export interface AIRequest {
  task: AITask;
  /** The selection the task operates on. Empty for `write` and `continue`. */
  text: string;
  /** Text before the cursor — what `continue` and `complete` build on. */
  context?: string;
  /** Free-form steer: the target language, the tone, or a custom instruction. */
  instruction?: string;
  /** Document language, e.g. `zh-CN`. Providers use it to answer in kind. */
  locale?: string;
}

/**
 * The whole AI contract. Implement `stream` and ultra-editor's slash menu,
 * bubble menu and ghost-text completion all light up — the editor never learns
 * which model, vendor or endpoint is behind it.
 *
 * `stream` yields incremental text chunks (deltas, not cumulative snapshots)
 * and must respect `signal`: when the user hits stop, the generator is expected
 * to stop pulling from the network and return.
 */
export interface AIProvider {
  stream(request: AIRequest, signal: AbortSignal): AsyncIterable<string>;
}

/**
 * A provider, or a getter for one.
 *
 * Extensions are built once when the editor is created, but a host's provider
 * often arrives later (a config fetch, a user toggling a setting). Accepting a
 * getter lets the extension read the current value on every use instead of
 * freezing whatever existed at construction time.
 */
export type AIProviderSource = AIProvider | null | (() => AIProvider | null | undefined);

export type Toggle = boolean | (() => boolean);

export function resolveProvider(source: AIProviderSource | undefined): AIProvider | null {
  if (typeof source === 'function') return source() ?? null;
  return source ?? null;
}

export function resolveToggle(toggle: Toggle | undefined, fallback = false): boolean {
  if (typeof toggle === 'function') return toggle();
  return toggle ?? fallback;
}

export type AIStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

export interface AIRunHandlers {
  onChunk?: (chunk: string, accumulated: string) => void;
  onDone?: (text: string) => void;
  onError?: (error: Error) => void;
  onAbort?: (partial: string) => void;
}
