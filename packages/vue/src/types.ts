import type {
  AIProvider,
  AITask,
  LocaleName,
  Messages,
  SlashItem,
  UploadHandler,
  ImageFetcher,
  ImageProcessingLimits,
  LowlightInstance
} from '@ultra-editor/core/lean';

export type TableAction =
  | 'rowBefore'
  | 'rowAfter'
  | 'colBefore'
  | 'colAfter'
  | 'delRow'
  | 'delCol'
  | 'merge'
  | 'split'
  | 'headerRow'
  | 'headerCol'
  | 'delTable';

export interface UltraEditorAIProps {
  provider?: AIProvider | null;
  /** Actions offered on the selection bubble. Defaults to the full set. */
  tasks?: AITask[];
  /** `/` palette. On by default whenever a provider is present. */
  slash?: boolean;
  slashItems?: SlashItem[];
  /** Idle autocomplete. Off by default — it spends tokens without being asked. */
  ghostText?: boolean;
  ghostDelay?: number;
}

export interface UltraEditorProps {
  /** Document HTML. Two-way bound. */
  modelValue?: string;
  placeholder?: string;
  editable?: boolean;
  autofocus?: boolean;
  locale?: LocaleName;
  messages?: Partial<Messages>;
  /** Upload seam. Without it, images inline as data URLs — fine for demos only. */
  upload?: UploadHandler;
  fetchImage?: ImageFetcher;
  maxImageSize?: number;
  uploadConcurrency?: number;
  /** Resource ceilings used while rotating or cropping decoded images. */
  imageProcessingLimits?: ImageProcessingLimits;
  /** Syntax highlighter with only the languages the host chooses to register. */
  lowlight?: LowlightInstance;
  /**
   * Markdown conveniences: the source-mode toggle in the toolbar and the
   * conversion of pasted Markdown. Both on unless this is `false`.
   */
  markdown?: boolean;
  ai?: UltraEditorAIProps;
  toolbar?: boolean;
  statusbar?: boolean;
  minHeight?: string;
  maxHeight?: string;
  /** Emit `update:modelValue` at most this often, in ms. 0 disables debouncing. */
  debounce?: number;
}
