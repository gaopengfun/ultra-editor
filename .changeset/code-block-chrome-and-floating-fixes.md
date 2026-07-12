---
'@ultra-editor/core': minor
'@ultra-editor/vue': minor
---

代码块补齐语言选择与复制，修复表格右键菜单的滚动条与二级色板，并对齐图片的八个缩放锚点。

**新增**

- 代码块现在带一条编辑态工具条：左侧语言选择器（列表取自宿主传入的 lowlight 实例），右侧复制按钮。语言写在 CodeBlock 原有的 `language` 属性上，序列化仍是 `<pre><code class="language-x">`，导出的 HTML 与只读渲染不受影响；工具条本身是 node view，不会进入产物。无 `navigator.clipboard`（非安全上下文）时不渲染复制按钮，只读时语言选择器禁用。
- 工具条由 core 以纯 DOM node view 绘制，React / Svelte 适配器无需自备实现。

**修复**

- 表格右键菜单会同时出现横竖两条滚动条：内容高度只比 `max-height` 多出 10px，而 `overflow-y: auto` 会让水平轴一并变成可滚动。菜单不再在水平方向滚动，垂直空间也放宽到不再需要滚动。
- 「单元格底色」的色板绝对定位在菜单内部，而菜单是滚动容器，二级面板只会被裁切、无法展开。色板改为 Teleport 到 `<body>` 的浮层，从菜单右侧展开；同一个面板也供工具栏的文字颜色使用。
- 「单元格底色」此前是 `div`，方向键漫游焦点走不到它；现在是真正的菜单项，`→` / `Enter` 展开，`Esc` 收回。
- 图片的八个缩放锚点中下方三个偏低、左右两个偏离中点：锚点贴着 resize wrapper 的边缘，而行内 `<img>` 会在下方留出基线间隙（200px 的图，wrapper 高 208px）。

**i18n**

- 新增 `codeBlock.language` / `codeBlock.plain` / `codeBlock.copy` / `codeBlock.copied`（`zhCN` 与 `en`）。
