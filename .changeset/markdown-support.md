---
'@ultra-editor/core': minor
'@ultra-editor/vue': minor
---

新增 Markdown 编辑能力：双向转换、粘贴自动识别、Vue 源码模式。

- `docToMarkdown(doc)` 与 `markdownToHTML(md)` —— 针对本编辑器 schema 手写的双向转换，不引第三方 Markdown 依赖（`prosemirror-markdown` 认不得表格、图注和分栏）。覆盖标题、段落、加粗 / 斜体 / 删除线 / 行内代码 / 链接、有序与无序列表（含嵌套）、引用、围栏代码块（带语言）、分割线、图片、GFM 表格与硬换行；Markdown 表达不了的（下划线、文字颜色、分栏）降级为纯文本而不是丢失。整套转换约 3.3 KB（gzip）。
- `MarkdownPaste` 扩展：粘贴纯文本时，只有在内容**明确**是 Markdown（`looksLikeMarkdown`：一个块级语法即可，行内语法需两种以上）才转成富文本。剪贴板带 `text/html` 时让位给 ProseMirror 自己的解析器；代码块内粘贴保持原样。可通过 `markdownPaste` getter 运行时开关，或 `features.markdown: false` 整个摘掉。
- Vue 组件新增 Markdown 源码模式：工具栏切换后编辑区换成 textarea，退出时套用回文档。源码模式下 textarea 是唯一事实来源（不反向重排作者正在敲的字），编辑内容按 `debounce`（默认 300ms）同步进文档，`v-model` 全程可信；未退出就卸载也会先落盘。
- Vue 组件新增 `getMarkdown()` / `setMarkdown()`，以及 `markdown` prop（默认开）。
- 解析器把源码里的裸 HTML 转义而非放行，`javascript:` 链接与非图片 `data:` URL 一律拒绝 —— 从剪贴板来的 Markdown 是不可信输入。
- 新增文案 `toolbar.markdown` / `markdown.exit` / `markdown.placeholder`（`zhCN` 与 `en`）。
