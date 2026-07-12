import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { createLowlight, common } from 'lowlight';

import { ImageFigure, DEFAULT_IMAGE_RESIZE } from './extensions/image-figure';
import { Column, ColumnBlock } from './extensions/columns';
import { ColorTableCell, ColorTableHeader } from './extensions/table-cells';
import { ResizableTableRow } from './extensions/table-row';
import { ImageUpload, type UploadError } from './extensions/image-upload';
import { AIStream } from './extensions/ai-stream';
import { GhostText } from './extensions/ghost-text';
import {
  SlashCommand,
  DEFAULT_SLASH_ITEMS,
  type SlashCommandOptions
} from './extensions/slash-command';
import { resolveUploadOptions, type UploadOptions } from './upload';
import { createTranslator, type LocaleName, type Messages } from './i18n';
import { resolveProvider, type AIProviderSource, type Toggle } from './ai/types';

export interface UltraKitAIOptions {
  /**
   * Without a provider every AI surface stays hidden — the editor still works.
   * Pass a getter if the provider is resolved after the editor is created.
   */
  provider?: AIProviderSource;
  /**
   * The `/` palette. Needs a renderer, which only a framework adapter can
   * supply, so core skips the extension entirely when one isn't given.
   *
   * Note the palette does NOT require AI: `/table`, `/h1` and friends work with
   * no provider configured; only the AI group hides itself.
   */
  slash?: Partial<SlashCommandOptions> & { enabled?: boolean };
  /** Idle autocomplete. Off unless explicitly enabled — it spends tokens unprompted. */
  ghostText?: {
    enabled?: Toggle;
    delay?: number;
    minChars?: number;
    contextLength?: number;
    hint?: string;
  };
}

export interface UltraKitOptions {
  /** Empty-document hint. Defaults to the locale's placeholder string. */
  placeholder?: string;
  locale?: LocaleName;
  messages?: Partial<Messages>;
  /** Image upload seam. Without an `upload` handler, images inline as data URLs. */
  upload?: UploadOptions;
  /** Called when an upload is rejected or fails, so the host can show a toast. */
  onUploadError?: (error: UploadError) => void;
  /**
   * A pre-configured lowlight instance. Defaults to lowlight's `common` set —
   * pass your own to trim the bundle or add languages.
   */
  lowlight?: ReturnType<typeof createLowlight>;
  /** AI surfaces. Omit entirely for a plain rich text editor. */
  ai?: UltraKitAIOptions;
  /** Turn feature groups off wholesale. All default to on. */
  features?: {
    image?: boolean;
    columns?: boolean;
    table?: boolean;
    codeBlock?: boolean;
    color?: boolean;
  };
}

/**
 * The assembly point. Everything framework-agnostic about ultra-editor comes out
 * of here as a plain Tiptap extension array — a React or Svelte adapter would
 * call exactly this and only supply its own chrome.
 */
export function createUltraKit(options: UltraKitOptions = {}): Extensions {
  const features = {
    image: true,
    columns: true,
    table: true,
    codeBlock: true,
    color: true,
    ...options.features
  };

  const t = createTranslator(options.locale ?? 'zh-CN', options.messages);
  const upload = resolveUploadOptions(options.upload);

  const extensions: Extensions = [
    // StarterKit's own code block is always off: when the feature is on we swap
    // in CodeBlockLowlight below, when it's off there should be no code block at
    // all. Passing `undefined` here would leave StarterKit's default enabled and
    // make `features.codeBlock: false` a no-op.
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false }
    }),
    Placeholder.configure({ placeholder: options.placeholder ?? t('editor.placeholder') })
  ];

  if (features.image) {
    extensions.push(
      ImageFigure.configure({ inline: false, resize: { ...DEFAULT_IMAGE_RESIZE } }),
      ImageUpload.configure({
        upload: upload.upload,
        maxSize: upload.maxSize,
        accept: upload.accept,
        onError: options.onUploadError
      })
    );
  }

  if (features.columns) {
    extensions.push(
      ColumnBlock.configure({
        locale: options.locale ?? 'zh-CN',
        messages: options.messages ?? {}
      }),
      Column
    );
  }

  if (features.table) {
    extensions.push(
      Table.configure({ resizable: true }),
      ResizableTableRow,
      ColorTableHeader,
      ColorTableCell
    );
  }

  if (features.color) {
    extensions.push(TextStyle, Color.configure({ types: [TextStyle.name] }));
  }

  if (features.codeBlock) {
    extensions.push(
      CodeBlockLowlight.configure({ lowlight: options.lowlight ?? createLowlight(common) })
    );
  }

  // AIStream ships unconditionally: its commands are what the host calls to run
  // a generation, and an editor with no provider simply never calls them.
  extensions.push(AIStream);

  const ai = options.ai;

  // The palette is registered whenever a renderer exists — it is a block-insertion
  // tool first and an AI surface second, so gating it on a provider would take
  // `/table` away from every editor that has no AI configured.
  const slash = ai?.slash;
  if (slash?.render && slash.enabled !== false) {
    extensions.push(
      SlashCommand.configure({
        items: slash.items ?? DEFAULT_SLASH_ITEMS,
        onAI: slash.onAI ?? (() => {}),
        labelOf: slash.labelOf ?? ((item) => t(item.labelKey)),
        hasAI: slash.hasAI ?? (() => !!resolveProvider(ai?.provider)),
        render: slash.render
      })
    );
  }

  // Registered even when currently disabled: `enabled` and `provider` are read
  // through getters on every idle tick, so a host can switch autocomplete on at
  // runtime without rebuilding the editor.
  if (ai) {
    const ghost = ai.ghostText;
    extensions.push(
      GhostText.configure({
        provider: ai.provider ?? null,
        enabled: ghost?.enabled ?? false,
        delay: ghost?.delay ?? 800,
        minChars: ghost?.minChars ?? 8,
        contextLength: ghost?.contextLength ?? 2000,
        locale: options.locale ?? 'zh-CN',
        hint: ghost?.hint ?? t('ai.ghostHint')
      })
    );
  }

  return extensions;
}
