export { default as UltraEditor } from './UltraEditor.vue';

export {
  useAi,
  type AIController,
  type AIMode,
  type AIPanelState,
  type AIPhase
} from './composables/useAi';
export { usePrompt, type PromptController, type PromptRequest } from './composables/usePrompt';
export {
  useToasts,
  type Toast,
  type ToastController,
  type ToastKind
} from './composables/useToasts';
export { ICONS } from './icons';
export type { TableAction, UltraEditorAIProps, UltraEditorProps } from './types';

// Re-exported so consumers install and import one package for the common case.
export * from '@ultra-editor/core/lean';
