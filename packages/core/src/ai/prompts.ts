import type { AIRequest, AITask } from './types';

/**
 * Prompt templates for the built-in tasks.
 *
 * These live in core rather than inside each provider so that swapping OpenAI
 * for Anthropic changes the transport and nothing else — the editor's behaviour
 * stays identical across vendors. Hosts that want different wording override
 * `promptFor` when constructing their provider.
 */

const RULES = [
  'You are a writing assistant embedded in a rich text editor.',
  'Return only the resulting prose. No preamble, no explanation, no markdown code fences.',
  'Match the language of the input unless explicitly told otherwise.',
  'Preserve the meaning and the register of the original unless the task says to change it.'
].join(' ');

const TASK_INSTRUCTIONS: Record<AITask, (request: AIRequest) => string> = {
  continue: (r) =>
    `Continue the following text naturally. Write one or two more paragraphs that flow from it.\n\n${r.context || r.text}`,

  complete: (r) =>
    `Complete the current sentence or thought. Reply with the continuation ONLY — do not repeat the given text, and keep it under 20 words.\n\n${r.context || r.text}`,

  write: (r) =>
    `Write a passage about the following topic.${r.locale ? ` Write in ${r.locale}.` : ''}\n\nTopic: ${r.instruction || r.text}`,

  improve: (r) =>
    `Improve the writing — clearer, tighter, better flow. Keep the meaning.\n\n${r.text}`,

  translate: (r) =>
    `Translate the following text into ${r.instruction || 'English'}. Output the translation only.\n\n${r.text}`,

  summarize: (r) => `Summarize the following text in a few sentences.\n\n${r.text}`,

  rewrite: (r) =>
    `Rewrite the following text in a different way while preserving the meaning.\n\n${r.text}`,

  expand: (r) =>
    `Expand the following text with more detail, examples or reasoning. Keep the same voice.\n\n${r.text}`,

  shorten: (r) =>
    `Make the following text shorter and denser without losing key information.\n\n${r.text}`,

  fixGrammar: (r) =>
    `Fix grammar, spelling and punctuation in the following text. Change nothing else.\n\n${r.text}`,

  changeTone: (r) =>
    `Rewrite the following text in a ${r.instruction || 'professional'} tone.\n\n${r.text}`,

  custom: (r) => `${r.instruction || 'Rewrite the following text.'}\n\n${r.text}`
};

export interface Prompt {
  system: string;
  user: string;
}

export function promptFor(request: AIRequest): Prompt {
  const build = TASK_INSTRUCTIONS[request.task] ?? TASK_INSTRUCTIONS.custom;
  const locale = request.locale ? ` The document language is ${request.locale}.` : '';
  return {
    system: RULES + locale,
    user: build(request)
  };
}

/** Tasks that read the selection; the rest work from the text before the cursor. */
export const SELECTION_TASKS: AITask[] = [
  'improve',
  'translate',
  'summarize',
  'rewrite',
  'expand',
  'shorten',
  'fixGrammar',
  'changeTone',
  'custom'
];
