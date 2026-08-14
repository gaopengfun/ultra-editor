---
'@ultra-editor/core': minor
'@ultra-editor/vue': patch
---

代码块语言选择开箱可用，语言目录改为按需加载。

- `@ultra-editor/vue` 此前从不注册任何 lowlight 语言：代码块语言下拉只有「纯文本」，且**完全没有语法高亮**。现在不传 `lowlight` 时会在挂载后把 lowlight 的 common 语言集作为独立异步 chunk 拉进来（gzip ~43 KB，不进主包），并重绘已经画在屏幕上的代码块。传 `lowlight` 则完全以宿主为准，不发起任何加载。
- 新增 `loadCommonLanguages(lowlight)` 与 `refreshCodeHighlighting(editor)` 两个导出，自己组装扩展的宿主可以复用同一套按需加载逻辑。
- 语言列表改为打开菜单时才构建：此前每个代码块在 node view 创建时就生成 38 个按钮，长文档全额付费；且构造之后注册的语言永远进不了列表。
