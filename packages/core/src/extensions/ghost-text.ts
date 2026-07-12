import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { resolveProvider, resolveToggle, type AIProviderSource, type Toggle } from '../ai/types';
import { isAbortError } from '../ai/engine';
import { isBrowser } from '../utils/env';
import { isAIStreaming } from './ai-stream';

export interface GhostTextOptions {
  /** Accepts a getter, so a provider that arrives after mount still works. */
  provider: AIProviderSource;
  /**
   * Off by default. Autocomplete fires on idle, which means it spends tokens
   * without anyone asking it to — that should be a deliberate choice.
   *
   * Accepts a getter so the host can toggle it at runtime.
   */
  enabled: Toggle;
  /** Idle time before a completion is requested, in ms. */
  delay: number;
  /** Minimum characters in the current block before suggesting anything. */
  minChars: number;
  /** How much preceding text to send as context, in characters. */
  contextLength: number;
  locale?: string;
  /** Badge shown beside the suggestion, e.g. "Tab to accept". */
  hint: string;
}

interface GhostState {
  text: string;
  pos: number;
}

interface GhostMeta {
  set?: GhostState;
  clear?: true;
}

const ghostKey = new PluginKey<GhostState | null>('ueGhostText');

export function ghostSuggestion(state: EditorState): GhostState | null {
  return ghostKey.getState(state) ?? null;
}

function ghostWidget(text: string, hint: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'ue-ghost';
  span.setAttribute('contenteditable', 'false');
  span.textContent = text;

  const badge = document.createElement('span');
  badge.className = 'ue-ghost__hint';
  badge.textContent = hint;
  span.appendChild(badge);

  return span;
}

/** Only suggest at the end of a text block with something already written. */
function shouldSuggest(state: EditorState, minChars: number): boolean {
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  if (isAIStreaming(state)) return false;

  // For a TextSelection `empty` means anchor and head sit on the same position,
  // which is exactly when `$cursor` is non-null — so the check above has already
  // ruled this out. Kept as a type narrowing, not as a case that can happen.
  const { $cursor } = selection as TextSelection;
  /* v8 ignore next */
  if (!$cursor) return false;
  if (!$cursor.parent.isTextblock) return false;
  if ($cursor.parent.type.name === 'codeBlock') return false;

  // Mid-block completion would need to reason about the text after the cursor;
  // suggesting only at the end keeps the model's job — and ours — honest.
  if ($cursor.pos !== $cursor.end()) return false;

  return $cursor.parent.textContent.trim().length >= minChars;
}

/**
 * Inline autocomplete: after a pause, the model proposes a continuation which
 * renders as grey ghost text. Tab accepts it, Esc dismisses it, and typing
 * anything at all invalidates it.
 *
 * The suggestion is a decoration, never document content, so an ignored
 * suggestion cannot end up in the saved HTML.
 */
export const GhostText = Extension.create<GhostTextOptions>({
  name: 'ghostText',

  addOptions() {
    return {
      provider: null,
      enabled: false,
      delay: 800,
      minChars: 8,
      contextLength: 2000,
      locale: undefined,
      hint: 'Tab'
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const suggestion = ghostSuggestion(editor.state);
        if (!suggestion) return false;
        editor
          .chain()
          .focus()
          .command(({ tr, dispatch }) => {
            // Guards the dry run Tiptap performs under `editor.can()`. A keyboard
            // shortcut is never dry-run, so nothing reaches this with no dispatch —
            // but a command that mutates during a probe is a trap worth keeping shut.
            /* v8 ignore else */
            if (dispatch) {
              tr.insertText(suggestion.text, suggestion.pos);
              tr.setMeta(ghostKey, { clear: true } satisfies GhostMeta);
            }
            return true;
          })
          .run();
        return true;
      },

      Escape: ({ editor }) => {
        if (!ghostSuggestion(editor.state)) return false;
        editor.view.dispatch(
          editor.state.tr.setMeta(ghostKey, { clear: true } satisfies GhostMeta)
        );
        return true;
      }
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const hint = options.hint;

    return [
      new Plugin<GhostState | null>({
        key: ghostKey,

        state: {
          init: () => null,
          apply(tr, current) {
            const meta = tr.getMeta(ghostKey) as GhostMeta | undefined;
            if (meta?.clear) return null;
            if (meta?.set) return meta.set;
            // Any edit or cursor move makes the suggestion stale.
            if (tr.docChanged || tr.selectionSet) return null;
            return current;
          }
        },

        props: {
          decorations(state) {
            const suggestion = ghostKey.getState(state);
            if (!suggestion || !isBrowser()) return DecorationSet.empty;
            return DecorationSet.create(state.doc, [
              Decoration.widget(suggestion.pos, () => ghostWidget(suggestion.text, hint), {
                side: 1
              })
            ]);
          }
        },

        view() {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let controller: AbortController | undefined;

          const cancel = () => {
            clearTimeout(timer);
            controller?.abort();
            controller = undefined;
          };

          const request = async (editorView: EditorView) => {
            const provider = resolveProvider(options.provider);
            if (!provider || !resolveToggle(options.enabled)) return;
            if (!shouldSuggest(editorView.state, options.minChars)) return;

            const pos = editorView.state.selection.from;
            const context = editorView.state.doc.textBetween(
              Math.max(0, pos - options.contextLength),
              pos,
              '\n\n',
              ' '
            );
            if (!context.trim()) return;

            controller = new AbortController();
            const signal = controller.signal;
            let text = '';

            try {
              for await (const chunk of provider.stream(
                { task: 'complete', text: '', context, locale: options.locale },
                signal
              )) {
                if (signal.aborted) return;
                text += chunk;

                // The document may have moved on while the model was thinking.
                // Belt and braces: moving the cursor sets `selectionSet`, which
                // drives the view update into `cancel()`, so in practice the abort
                // check above catches this first.
                /* v8 ignore next */
                if (editorView.state.selection.from !== pos) return;
                if (!text.trim()) continue;

                editorView.dispatch(
                  editorView.state.tr.setMeta(ghostKey, {
                    set: { text, pos }
                  } satisfies GhostMeta)
                );
              }
            } catch (error) {
              if (!isAbortError(error)) {
                // A failed completion nobody asked for should stay invisible.
                cancel();
              }
            }
          };

          const schedule = (editorView: EditorView) => {
            cancel();
            if (!resolveToggle(options.enabled) || !resolveProvider(options.provider)) return;
            if (!editorView.editable) return;
            if (!shouldSuggest(editorView.state, options.minChars)) return;
            timer = setTimeout(() => void request(editorView), options.delay);
          };

          return {
            update(editorView, prevState) {
              const current = ghostKey.getState(editorView.state);
              const previous = ghostKey.getState(prevState);

              // A suggestion is on screen: nothing to schedule.
              if (current) return;

              // One just went away — accepted with Tab, or dismissed with Esc.
              // Abort whatever is still streaming: Esc changes neither the doc nor
              // the selection, so without this the request runs on and its next
              // chunk puts the dismissed suggestion straight back on screen.
              if (previous) {
                cancel();
                return;
              }

              if (
                editorView.state.doc.eq(prevState.doc) &&
                editorView.state.selection.eq(prevState.selection)
              ) {
                return;
              }
              schedule(editorView);
            },
            destroy: cancel
          };
        }
      })
    ];
  }
});
