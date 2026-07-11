import { Extension, type Editor, type Range } from '@tiptap/core';
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import type { AITask } from '../ai/types';
import type { MessageKey } from '../i18n';

export type SlashGroup = 'basic' | 'insert' | 'ai';

export interface SlashContext {
  editor: Editor;
  range: Range;
  /** Hand control to the host's AI surface — core owns no UI. */
  ai: (task: AITask, instruction?: string) => void;
}

export interface SlashItem {
  key: string;
  group: SlashGroup;
  /** i18n key resolved by the rendering layer, so one item list serves all locales. */
  labelKey: MessageKey;
  /** Extra words that should match this item when typed after the slash. */
  keywords: string[];
  icon: string;
  run: (context: SlashContext) => void;
}

export const slashCommandKey = new PluginKey('ueSlashCommand');

/** Item catalogue. Filtered by the host via `SlashCommandOptions.items`. */
export const DEFAULT_SLASH_ITEMS: SlashItem[] = [
  {
    key: 'h1',
    group: 'basic',
    labelKey: 'toolbar.h1',
    keywords: ['h1', 'heading', 'title', 'biaoti'],
    icon: 'h1',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()
  },
  {
    key: 'h2',
    group: 'basic',
    labelKey: 'toolbar.h2',
    keywords: ['h2', 'heading', 'biaoti'],
    icon: 'h2',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()
  },
  {
    key: 'h3',
    group: 'basic',
    labelKey: 'toolbar.h3',
    keywords: ['h3', 'heading', 'biaoti'],
    icon: 'h3',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()
  },
  {
    key: 'bulletList',
    group: 'basic',
    labelKey: 'toolbar.bulletList',
    keywords: ['ul', 'list', 'bullet', 'liebiao'],
    icon: 'bulletList',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
  },
  {
    key: 'orderedList',
    group: 'basic',
    labelKey: 'toolbar.orderedList',
    keywords: ['ol', 'list', 'number', 'liebiao'],
    icon: 'orderedList',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
  },
  {
    key: 'blockquote',
    group: 'basic',
    labelKey: 'toolbar.blockquote',
    keywords: ['quote', 'yinyong'],
    icon: 'quote',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
  },
  {
    key: 'codeBlock',
    group: 'basic',
    labelKey: 'toolbar.codeBlock',
    keywords: ['code', 'daima'],
    icon: 'code',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
  },
  {
    key: 'table',
    group: 'insert',
    labelKey: 'toolbar.table',
    keywords: ['table', 'grid', 'biaoge'],
    icon: 'table',
    run: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
  },
  {
    key: 'columns',
    group: 'insert',
    labelKey: 'toolbar.columns',
    keywords: ['columns', 'card', 'fenlan'],
    icon: 'columns',
    run: ({ editor, range }) => editor.chain().focus().deleteRange(range).insertColumns(2).run()
  },
  {
    key: 'hr',
    group: 'insert',
    labelKey: 'toolbar.hr',
    keywords: ['hr', 'divider', 'fengexian'],
    icon: 'hr',
    run: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
  },
  {
    key: 'ai-continue',
    group: 'ai',
    labelKey: 'ai.continue',
    keywords: ['ai', 'continue', 'xuxie'],
    icon: 'ai',
    run: ({ editor, range, ai }) => {
      editor.chain().focus().deleteRange(range).run();
      ai('continue');
    }
  },
  {
    key: 'ai-write',
    group: 'ai',
    labelKey: 'ai.write',
    keywords: ['ai', 'write', 'xie'],
    icon: 'ai',
    run: ({ editor, range, ai }) => {
      editor.chain().focus().deleteRange(range).run();
      ai('write');
    }
  }
];

export interface SlashCommandOptions {
  items: SlashItem[];
  /** Called when a slash item wants AI; the host opens its prompt/preview UI. */
  onAI: (task: AITask, instruction?: string) => void;
  /** Supplied by the framework adapter — core never renders a menu itself. */
  render: SuggestionOptions<SlashItem>['render'];
  /** Match items by label too; the adapter passes a locale-aware resolver. */
  labelOf: (item: SlashItem) => string;
}

/**
 * `/` command palette.
 *
 * The item list, the AI hook and the renderer are all injected, which is what
 * lets a Vue adapter render a Vue menu and a future React adapter render a
 * React one over the exact same command set.
 */
export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return {
      items: DEFAULT_SLASH_ITEMS,
      onAI: () => {},
      render: () => ({}),
      labelOf: (item) => item.key
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: '/',
        pluginKey: slashCommandKey,
        allowSpaces: false,
        startOfLine: false,

        items: ({ query }) => {
          const needle = query.trim().toLowerCase();
          if (!needle) return options.items;
          return options.items.filter((item) => {
            if (item.key.toLowerCase().includes(needle)) return true;
            if (options.labelOf(item).toLowerCase().includes(needle)) return true;
            return item.keywords.some((keyword) => keyword.toLowerCase().includes(needle));
          });
        },

        command: ({ editor, range, props }) => {
          props.run({ editor, range, ai: options.onAI });
        },

        render: options.render
      })
    ];
  }
});
