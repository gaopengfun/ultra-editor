# @ultra-editor/vue

## 1.1.0

### Minor Changes

- 7e90cac: 代码块补齐语言选择与复制，修复表格右键菜单的滚动条与二级色板，并对齐图片的八个缩放锚点。

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

- b156fa9: 修复流式生成、代码块开关与图片抓取安全，并补齐浮层的键盘可访问性。

  **修复**

  - AI 流式区域在生成结束后遇到外来事务（例如点击移动光标）时会丢掉 `consumedEmptyBlock` 记账，导致 `/write` 的丢弃 / 撤销吞掉用户原本所在的空段落。
  - `features.codeBlock: false` 此前无法真正关闭代码块，只会退化成无语法高亮的普通代码块；现在彻底移除。
  - 选区气泡菜单展开 AI 子菜单后，在别处点击会让气泡残留在屏幕上；现加入外部点击关闭。
  - SSE 解析：当服务端在最后一个 `data:` 之后不带空行就关闭连接时（vLLM / Ollama / 自建代理常见），最后一个 delta 会被丢弃；现在流结束时 flush 补齐。
  - 图片上传在编辑器已销毁后仍向 view dispatch 会抛错；现加入 `isDestroyed` 守卫。
  - `useToasts` 的自动消失定时器与 `UeCropper` 拖拽的 document 监听在卸载时未清理；现随作用域销毁一并清理。

  **安全**

  - 默认图片抓取（裁切 / 旋转所用的 `defaultImageFetcher` 与 `UeCropper`）改用 `credentials: 'same-origin'`，不再对文档内可控的 URL 发送带 Cookie 的跨域请求。需要携带凭据的宿主通过注入 `fetchImage` 显式开启。

  **可访问性**

  - 模态对话框（含图片裁切）加入焦点陷阱、打开时聚焦、关闭时归还焦点，并补上 `aria-labelledby`。
  - 图片 / 表格右键菜单支持 ↑ / ↓ / Home / End 键盘导航，打开时聚焦首项、关闭时归还焦点。
  - AI 面板在生成中 / 完成 / 出错态支持 Esc 关闭。

  **其他**

  - 移除 10 个从未使用的 i18n key（`ai.tone.*`、`toolbar.highlight`、`toolbar.taskList`、`slash.placeholder`、`ai.aborted`、`common.close`）。如果你曾通过 `messages` 覆盖过这些键，请一并删除。
  - 修正 `link.invalid` 文案：此前声称"仅支持 http/https"，实际也允许 mailto / tel 与相对链接。

### Patch Changes

- Updated dependencies [7e90cac]
- Updated dependencies [b156fa9]
  - @ultra-editor/core@1.1.0

## 1.0.0

AI Native 编辑器 SDK 首个正式版本。

- **AI Native**：斜杠命令面板、选区 AI 气泡菜单、文档内流式生成（可中断 / 重试 / 丢弃）、Tab 接受的幽灵文本补全。通过 `AIProvider` 接口注入，不绑定任何厂商；附赠 OpenAI 兼容与 Anthropic 适配器。
- **接受一次 AI 生成 = 一步撤销**：流式写入不进历史栈，接受时才作为一个普通编辑重放，丢弃则不留痕迹。
- **零 UI 依赖**：移除 Element Plus 与 vue-advanced-cropper，自建对话框 / toast / 取色器 / 画布裁切器。
- **上传解耦**：`UploadHandler` 注入，SDK 内不含任何 HTTP 客户端、URL 或鉴权逻辑。
- **`--ue-*` 样式变量体系**：全部带兜底值，覆盖即换肤，内置深浅色主题。编辑态与阅读态共用一份 `content.css`。
- 编辑器能力：图片（旋转 / 裁切 / 8 锚点缩放 / 对齐 / 图注 / 粘贴与拖拽上传）、1-5 栏卡片、可拖拽行高列宽与单元格底色的表格、代码高亮、字数统计、中英文 i18n、只读模式、SSR guard。

### Dependencies

- 依赖 `@ultra-editor/core@1.0.0`
