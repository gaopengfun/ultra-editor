# API 参考

## `<UltraEditor>`

### Props

| Prop                      | 类型                 | 默认                  | 说明                                                 |
| ------------------------- | -------------------- | --------------------- | ---------------------------------------------------- |
| `modelValue`              | `string`             | `''`                  | 文档 HTML，双向绑定                                  |
| `placeholder`             | `string`             | 当前语言的默认提示    | 空文档提示语                                         |
| `editable`                | `boolean`            | `true`                | 为 `false` 时隐藏工具栏、禁止编辑                    |
| `autofocus`               | `boolean`            | `false`               | 挂载后自动聚焦                                       |
| `locale`                  | `'zh-CN' \| 'en'`    | `'zh-CN'`             | 界面语言                                             |
| `messages`                | `Partial<Messages>`  | `{}`                  | 覆盖任意单条文案，无需 fork 语言包                   |
| `upload`                  | `UploadHandler`      | base64 兜底           | 图片上传实现                                         |
| `fetchImage`              | `ImageFetcher`       | `fetch` + credentials | 旋转 / 裁切时取回原图                                |
| `maxImageSize`            | `number`             | `5 * 1024 * 1024`     | 超过则拒绝，单位字节                                 |
| `uploadConcurrency`       | `number`             | `3`                   | 同时上传的图片数量，至少为 1                         |
| `imageProcessingLimits`   | `ImageProcessingLimits` | 见下方默认值       | 旋转 / 裁切时的源图与 Canvas 资源上限                |
| `lowlight`                | `LowlightInstance`    | 挂载后异步加载 common | 自定义代码高亮语言集，传了就完全以它为准             |
| `ai`                      | `UltraEditorAIProps` | —                     | AI 配置，不传则无任何 AI 界面                        |
| `toolbar`                 | `boolean`            | `true`                | 是否显示工具栏                                       |
| `statusbar`               | `boolean`            | `true`                | 是否显示字数统计栏                                   |
| `minHeight` / `maxHeight` | `string`             | `500px` / `70vh`      | 编辑区高度                                           |
| `debounce`                | `number`             | `0`                   | `update:modelValue` 的节流间隔（ms），`0` 表示不节流 |

### `ai` 配置

```ts
interface UltraEditorAIProps {
  provider?: AIProvider | null; // 不传则所有 AI 界面隐藏
  tasks?: AITask[]; // 气泡菜单里提供哪些动作，默认全部
  slash?: boolean; // `/` 命令面板，默认 true（有 provider 时）
  slashItems?: SlashItem[]; // 自定义命令列表
  ghostText?: boolean; // 幽灵补全，默认 false
  ghostDelay?: number; // 停止输入多久后请求补全，默认 800ms
}
```

### Events

| 事件                | 载荷          | 说明                                                          |
| ------------------- | ------------- | ------------------------------------------------------------- |
| `update:modelValue` | `string`      | 内容变化                                                      |
| `change`            | `string`      | 同上，语义化别名                                              |
| `upload-error`      | `UploadError` | 上传被拒绝或失败（编辑器已自行弹提示，此事件供你埋点 / 上报） |

```ts
interface UploadError {
  code: 'too-large' | 'unsupported' | 'failed';
  file: File | Blob;
  size: string; // 已格式化，如 "7.31MB"
  max: string;
}
```

### 暴露的方法（`ref`）

```ts
const editorRef = ref<InstanceType<typeof UltraEditor>>();

editorRef.value.getHTML(); // string
editorRef.value.getText(); // string
editorRef.value.getJSON(); // JSONContent
editorRef.value.setContent(html);
editorRef.value.focus();
editorRef.value.clear();
editorRef.value.runAI('improve'); // 以编程方式触发 AI 动作
editorRef.value.editor; // 底层 Tiptap Editor 实例（逃生舱）
```

`editor` 是完整的 Tiptap 实例。这里没有暴露的任何能力，都可以从它拿到。

---

## `@ultra-editor/core`

### `createUltraKit(options)`

返回一个 Tiptap 扩展数组。这是框架无关的组装点 —— React 适配器要做的就是调它，然后套上自己的界面。

```ts
import { Editor } from '@tiptap/core';
import { createUltraKit } from '@ultra-editor/core';

const editor = new Editor({
  element,
  extensions: createUltraKit({
    locale: 'zh-CN',
    upload: { upload: myUploadHandler, maxSize: 5 * 1024 * 1024 },
    features: { table: false } // 按需关闭整组功能
  })
});
```

| 选项                                  | 说明                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `placeholder` / `locale` / `messages` | 同组件 props                                            |
| `upload`                              | `{ upload?, fetchImage?, maxSize?, accept? }`           |
| `onUploadError`                       | 上传失败回调                                            |
| `lowlight`                            | 自定义 lowlight 实例，用于选择代码高亮语言              |
| `markdownPaste`                       | 粘贴 Markdown 自动转换，默认开；可传 getter 运行时切换  |
| `ai`                                  | `{ provider, slash, ghostText }`                        |
| `features`                            | `{ image, columns, table, codeBlock, color, markdown }`，默认全开 |

core 默认入口同步包含 lowlight 的 common 语言集（37 种主流语言）；lean 子路径不注册任何语言，由调用方自己决定：

```ts
import { createLowlight, createUltraKit } from '@ultra-editor/core/lean';

const lowlight = createLowlight();
// lowlight.register('typescript', typescriptLanguage)
const extensions = createUltraKit({ lowlight });
```

Vue 组件走的是 lean 入口，但不传 `lowlight` 时会在挂载后把 common 语言集**作为独立 chunk 异步拉进来**：主包里没有这 ~43 KB（gzip）语法解析器，代码块的语言下拉和高亮又都是开箱可用的。想自己掌控语言集就传 `lowlight`，此时组件不会再加载任何东西：

```ts
import { createLowlight } from '@ultra-editor/vue';
import typescript from 'highlight.js/lib/languages/typescript';

const lowlight = createLowlight();
lowlight.register('typescript', typescript);
// <UltraEditor :lowlight="lowlight" />
```

自己组装扩展时，这两步对应 core 导出的 `loadCommonLanguages(lowlight)` 与 `refreshCodeHighlighting(editor)` —— 后者用来重绘语法到位之前就已经画出来的代码块（lowlight 插件只在文档变化时才重算高亮）。

### 扩展

单独导出，可以脱离 kit 使用：

`ImageFigure` · `ImageUpload` · `Column` / `ColumnBlock` · `ColorTableCell` / `ColorTableHeader` · `ResizableTableRow` · `AIStream` · `GhostText` · `SlashCommand`

### AI

```ts
runAITask(provider, request, handlers): AIRun
collectAI(provider, request, signal?): Promise<string>
promptFor(request): { system, user }
SELECTION_TASKS: AITask[]
```

`AIRun.done` 在**中断时也会 resolve**（返回已生成的部分），只有真正的失败才 reject —— 用户点停止不是错误。

### 工具函数

```ts
isSafeLinkUrl(url)    // 链接协议白名单
isSafeImageUrl(url)   // 图片协议白名单（data: 仅允许 image/*）
contrastText(bg)      // 依底色算出可读的文字色
transformImage(src, transform, fetchImage?, limits?): Promise<Blob>
rotateImage(src, 90 | -90, fetchImage?, limits?): Promise<Blob>
```

默认拒绝超过 8000 万像素的解码源图，并把导出结果等比限制在 1600 万像素、单边 8192 像素以内。可通过 `ImageProcessingLimits` 调整。

### Markdown

```ts
docToMarkdown(editor.state.doc); // 文档 → Markdown
markdownToHTML(md); // Markdown → HTML，可直接喂 setContent
looksLikeMarkdown(text); // 这段纯文本值不值得当 Markdown 解析
```

方言是 CommonMark 的常用部分 + GFM 表格与删除线，也就是本编辑器 schema 装得下的子集：标题、段落、加粗 / 斜体 / 删除线 / 行内代码 / 链接、有序无序列表（含嵌套）、引用、围栏代码块（带语言）、分割线、图片、表格、硬换行。

- **Markdown 表达不了的会降级而不是丢失**：下划线和文字颜色留下文字，分栏按顺序摊平成若干块。
- **源码里的裸 HTML 一律转义**，`javascript:` 链接和非图片 `data:` URL 直接拒绝 —— 从剪贴板来的 Markdown 是不可信输入。
- **粘贴自动识别是保守的**：一个块级语法（`# `、`- `、`> `、围栏、表格分隔行……）即可判定；只有行内语法时要出现两种以上才算。把别人的普通段落重排，比让一行 `# text` 原样落地更糟。剪贴板里带 `text/html` 时不接管，代码块内也不接管。

自己组装扩展时，`MarkdownPaste` 需要显式加入（`createUltraKit` 默认已含，`features.markdown: false` 可摘掉）。

### 命令

除了 Tiptap 自带的命令，本 SDK 额外注册：

```ts
editor.commands.insertColumns(3); // 插入 1-5 栏卡片，已在栏内时拒绝
editor.commands.uploadImages(files); // 上传并插入图片
editor.commands.aiStreamStart(); // 开启一个 AI 生成区域
editor.commands.aiStreamSet(text); // 把累积文本渲染进该区域（幂等）
editor.commands.aiStreamAccept(); // 保留，作为一步可撤销的编辑
editor.commands.aiStreamDiscard(); // 丢弃，不留痕迹
```
