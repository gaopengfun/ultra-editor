import type { Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import type { createLowlight } from 'lowlight';

import { ImageFigure, DEFAULT_IMAGE_RESIZE } from './extensions/image-figure';
import { UltraCodeBlock } from './extensions/code-block';
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
import { createTranslator, type LocaleName, type Messages, type Translator } from './i18n';
import { resolveProvider, type AIProviderSource, type Toggle } from './ai/types';

export type LowlightInstance = ReturnType<typeof createLowlight>;

export interface UltraKitAIOptions {
  /**
   * Without a provider every AI surface stays hidden. Pass a getter if the
   * provider is resolved after the editor is created.
   */
  provider?: AIProviderSource;
  /**
   * The `/` palette. It needs a renderer from the framework adapter, but its
   * non-AI commands remain available without a provider.
   */
  slash?: Partial<SlashCommandOptions>;
  /** Idle autocomplete. Off unless explicitly enabled because it spends tokens unprompted. */
  ghostText?: {
    enabled?: Toggle;
    delay?: number | (() => number);
    minChars?: number;
    contextLength?: number;
    locale?: string | (() => string);
    hint?: string | (() => string);
  };
}

export interface UltraKitOptions {
  /** Empty-document hint. Defaults to the locale's placeholder string. */
  placeholder?: string | (() => string);
  locale?: LocaleName;
  messages?: Partial<Messages>;
  /** Live translator supplied by a framework adapter when locale can change at runtime. */
  translator?: () => Translator;
  /** Image upload seam. Without an upload handler, images are stored as data URLs. */
  upload?: UploadOptions;
  /** Called when an upload is rejected or fails, so the host can surface it. */
  onUploadError?: (error: UploadError) => void;
  /** Pre-configured syntax highlighter. The full entry defaults to lowlight's common set. */
  lowlight?: LowlightInstance;
  ai?: UltraKitAIOptions;
  /** Turn feature groups off wholesale. All groups default to enabled. */
  features?: {
    image?: boolean;
    columns?: boolean;
    table?: boolean;
    codeBlock?: boolean;
    color?: boolean;
  };
}

/**
 * Framework-agnostic extension assembly shared by the full and lean package
 * entries. It deliberately has no runtime dependency on lowlight's common set.
 */
export function createUltraKitWithLowlight(
  options: UltraKitOptions,
  defaultLowlight: () => LowlightInstance
): Extensions {
  const features = {
    image: true,
    columns: true,
    table: true,
    codeBlock: true,
    color: true,
    ...options.features
  };

  const fallback = createTranslator(options.locale ?? 'zh-CN', options.messages);
  const t = options.translator ?? (() => fallback);
  const upload = resolveUploadOptions(options.upload);

  const extensions: Extensions = [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false }
    }),
    Placeholder.configure({
      placeholder:
        options.placeholder ??
        (options.translator ? () => t()('editor.placeholder') : fallback('editor.placeholder'))
    })
  ];

  if (features.image) {
    extensions.push(
      ImageFigure.configure({
        inline: false,
        allowBase64: true,
        resize: { ...DEFAULT_IMAGE_RESIZE }
      }),
      ImageUpload.configure({
        upload: upload.upload,
        maxSize: options.upload?.maxSize ?? upload.maxSize,
        concurrency: options.upload?.concurrency ?? upload.concurrency,
        accept: upload.accept,
        onError: options.onUploadError
      })
    );
  }

  if (features.columns) {
    extensions.push(
      ColumnBlock.configure({
        locale: options.locale ?? 'zh-CN',
        messages: options.messages ?? {},
        translator: options.translator
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
      UltraCodeBlock.configure({
        lowlight: options.lowlight ?? defaultLowlight(),
        locale: options.locale ?? 'zh-CN',
        messages: options.messages ?? {},
        translator: options.translator
      })
    );
  }

  extensions.push(AIStream);

  const ai = options.ai;
  const slash = ai?.slash;
  if (slash?.render && slash.enabled !== false) {
    extensions.push(
      SlashCommand.configure({
        items: slash.items ?? DEFAULT_SLASH_ITEMS,
        enabled: slash.enabled ?? true,
        onAI: slash.onAI ?? (() => {}),
        labelOf: slash.labelOf ?? ((item) => t()(item.labelKey)),
        hasAI: slash.hasAI ?? (() => !!resolveProvider(ai?.provider)),
        render: slash.render
      })
    );
  }

  if (ai) {
    const ghost = ai.ghostText;
    extensions.push(
      GhostText.configure({
        provider: ai.provider ?? null,
        enabled: ghost?.enabled ?? false,
        delay: ghost?.delay ?? 800,
        minChars: ghost?.minChars ?? 8,
        contextLength: ghost?.contextLength ?? 2000,
        locale: ghost?.locale ?? options.locale ?? 'zh-CN',
        hint:
          ghost?.hint ?? (options.translator ? () => t()('ai.ghostHint') : fallback('ai.ghostHint'))
      })
    );
  }

  return extensions;
}
