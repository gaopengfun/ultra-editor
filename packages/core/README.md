# @ultra-editor/core

**ultra-editor 的框架无关内核：Tiptap 扩展、AI 引擎、样式表。**

Vue 用户请直接装 `@ultra-editor/vue` —— 它会把这个包一并带上。

单独装它，是为了写自定义扩展，或者给 React / Svelte 做适配层。

> **⚠️ 尚未发布到 npm。** 下面的命令要等首次发布之后才可用。

```bash
pnpm add @ultra-editor/core
```

```ts
import { Editor } from '@tiptap/core';
import { createUltraKit } from '@ultra-editor/core';

const editor = new Editor({
  element,
  extensions: createUltraKit({
    upload: { upload: myUploadHandler },
    ai: { provider: myAIProvider }
  })
});
```

包含：

- **扩展** —— `ImageFigure`（对齐 / 图注 / 8 锚点缩放）、`ImageUpload`（粘贴与拖拽）、`ColumnBlock`（1-5 栏卡片）、`ResizableTableRow`、带底色的表格单元格、`AIStream`、`GhostText`、`SlashCommand`
- **AI 引擎** —— `AIProvider` 抽象、流式执行器（可中断）、prompt 体系，以及 OpenAI 兼容 / Anthropic 两个可选适配器
- **样式** —— `styles.css`（编辑器全套）与 `content.css`（只读渲染复用同一份内容样式）

📖 **完整文档：** https://github.com/gaopengfun/ultra-editor

## License

MIT
