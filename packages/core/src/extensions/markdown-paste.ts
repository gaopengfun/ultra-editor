import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { resolveToggle, type Toggle } from '../ai/types';
import { looksLikeMarkdown, markdownToHTML } from '../markdown';

export interface MarkdownPasteOptions {
  /** Runtime toggle; the plugin stays mounted so a host can switch it back on. */
  enabled: Toggle;
}

export const markdownPasteKey = new PluginKey('ueMarkdownPaste');

/**
 * Turn pasted Markdown into rich content.
 *
 * Only plain text is considered: when the clipboard also carries `text/html` the
 * source app has already said what it means, and ProseMirror's own parser is a
 * better reader of it than this one. And only text that unambiguously *is*
 * Markdown is converted — see `looksLikeMarkdown`. Restructuring someone's prose
 * because it contained an asterisk is a worse failure than pasting a heading as
 * literal `# text`, which the author can fix in one keystroke.
 */
export const MarkdownPaste = Extension.create<MarkdownPasteOptions>({
  name: 'markdownPaste',

  addOptions() {
    return { enabled: true };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const editor = this.editor;

    return [
      new Plugin({
        key: markdownPasteKey,
        props: {
          handlePaste(view, event) {
            if (!view.editable || !resolveToggle(options.enabled, true)) return false;

            const clipboard = event.clipboardData;
            if (!clipboard) return false;
            if (clipboard.getData('text/html')) return false;

            const text = clipboard.getData('text/plain');
            if (!text || !looksLikeMarkdown(text)) return false;

            // Inside a code block, plain text is exactly the point — pasting a
            // Markdown sample there must not turn it into headings and lists.
            if (view.state.selection.$from.parent.type.name === 'codeBlock') return false;

            event.preventDefault();
            editor.commands.insertContent(markdownToHTML(text));
            return true;
          }
        }
      })
    ];
  }
});
