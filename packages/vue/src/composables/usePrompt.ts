import { reactive } from 'vue';

export interface PromptRequest {
  title: string;
  label?: string;
  placeholder?: string;
  value?: string;
  /** Return an error message to keep the dialog open, or null to accept. */
  validate?: (value: string) => string | null;
}

export interface PromptState extends PromptRequest {
  visible: boolean;
  input: string;
  error: string | null;
}

export interface PromptController {
  state: PromptState;
  /** Resolves with the entered text, or null when cancelled. */
  open: (request: PromptRequest) => Promise<string | null>;
  confirm: () => void;
  cancel: () => void;
}

/**
 * A promise-shaped replacement for `ElMessageBox.prompt` — the one Element Plus
 * API the old editor could not live without. Keeping the SDK dependency-free
 * meant re-growing it, which turned out to be twenty lines.
 */
export function usePrompt(): PromptController {
  const state = reactive<PromptState>({
    visible: false,
    title: '',
    label: '',
    placeholder: '',
    input: '',
    error: null
  });

  let settle: ((value: string | null) => void) | null = null;

  const open = (request: PromptRequest) =>
    new Promise<string | null>((resolve) => {
      // A second prompt while one is open would strand the first promise forever.
      settle?.(null);

      state.title = request.title;
      state.label = request.label ?? '';
      state.placeholder = request.placeholder ?? '';
      state.validate = request.validate;
      state.input = request.value ?? '';
      state.error = null;
      state.visible = true;
      settle = resolve;
    });

  const finish = (value: string | null) => {
    state.visible = false;
    const resolve = settle;
    settle = null;
    resolve?.(value);
  };

  const confirm = () => {
    const error = state.validate?.(state.input) ?? null;
    if (error) {
      state.error = error;
      return;
    }
    finish(state.input);
  };

  return { state, open, confirm, cancel: () => finish(null) };
}
