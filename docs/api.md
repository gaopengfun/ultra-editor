# API 参考

## `<UltraEditor>`

### Props

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `modelValue` | `string` | `''` | 文档 HTML，双向绑定 |
| `placeholder` | `string` | 当前语言的默认提示 | 空文档提示语 |
| `editable` | `boolean` | `true` | 为 `false` 时隐藏工具栏、禁止编辑 |
| `autofocus` | `boolean` | `false` | 挂载后自动聚焦 |
| `locale` | `'zh-CN' \| 'en'` | `'zh-CN'` | 界面语言 |
| `messages` | `Partial<Messages>` | `{}` | 覆盖任意单条文案，无需 fork 语言包 |
| `upload` | `UploadHandler` | base64 兜底 | 图片上传实现 |
| `fetchImage` | `ImageFetcher` | `fetch` + credentials | 旋转 / 裁切时取回原图 |
| `maxImageSize` | `number` | `5 * 1024 * 1024` | 超过则拒绝，单位字节 |
| `ai` | `UltraEditorAIProps` | — | AI 配置，不传则无任何 AI 界面 |
| `toolbar` | `boolean` | `true` | 是否显示工具栏 |
| `statusbar` | `boolean` | `true` | 是否显示字数统计栏 |
| `minHeight` / `maxHeight` | `string` | `500px` / `70vh` | 编辑区高度 |
| `debounce` | `number` | `0` | `update:modelValue` 的节流间隔（ms），`0` 表示不节流 |

### `ai` 配置

```ts
interface UltraEditorAIProps {
  provider?: AIProvider | null;   // 不传则所有 AI 界面隐藏
  tasks?: AITask[];               // 气泡菜单里提供哪些动作，默认全部
  slash?: boolean;                // `/` 命令面板，默认 true（有 provider 时）
  slashItems?: SlashItem[];       // 自定义命令列表
  ghostText?: boolean;            // 幽灵补全，默认 false
  ghostDelay?: number;            // 停止输入多久后请求补全，默认 800ms
}
```

### Events

| 事件 | 载荷 | 说明 |
|------|------|------|
| `update:modelValue` | `string` | 内容变化 |
| `change` | `string` | 同上，语义化别名 |
| `upload-error` | `UploadError` | 上传被拒绝或失败（编辑器已自行弹提示，此事件供你埋点 / 上报） |

```ts
interface UploadError {
  code: 'too-large' | 'unsupported' | 'failed';
  file: File | Blob;
  size: string;   // 已格式化，如 "7.31MB"
  max: string;
}
```

### 暴露的方法（`ref`）

```ts
const editorRef = ref<InstanceType<typeof UltraEditor>>();

editorRef.value.getHTML();        // string
editorRef.value.getText();        // string
editorRef.value.getJSON();        // JSONContent
editorRef.value.setContent(html);
editorRef.value.focus();
editorRef.value.clear();
editorRef.value.runAI('improve'); // 以编程方式触发 AI 动作
editorRef.value.editor;           // 底层 Tiptap Editor 实例（逃生舱）
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
    features: { table: false }        // 按需关闭整组功能
  })
});
```

| 选项 | 说明 |
|------|------|
| `placeholder` / `locale` / `messages` | 同组件 props |
| `upload` | `{ upload?, fetchImage?, maxSize?, accept? }` |
| `onUploadError` | 上传失败回调 |
| `lowlight` | 自定义 lowlight 实例，用于裁剪代码高亮语言包体积 |
| `ai` | `{ provider, slash, ghostText }` |
| `features` | `{ image, columns, table, codeBlock, color }`，默认全开 |

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
transformImage(src, { crop, rotate, flipH, flipV }, fetchImage?): Promise<Blob>
rotateImage(src, 90 | -90, fetchImage?): Promise<Blob>
```

### 命令

除了 Tiptap 自带的命令，本 SDK 额外注册：

```ts
editor.commands.insertColumns(3);          // 插入 1-5 栏卡片，已在栏内时拒绝
editor.commands.uploadImages(files);       // 上传并插入图片
editor.commands.aiStreamStart();           // 开启一个 AI 生成区域
editor.commands.aiStreamSet(text);         // 把累积文本渲染进该区域（幂等）
editor.commands.aiStreamAccept();          // 保留，作为一步可撤销的编辑
editor.commands.aiStreamDiscard();         // 丢弃，不留痕迹
```
