---
'@ultra-editor/core': minor
'@ultra-editor/vue': minor
---

修复流式生成、代码块开关与图片抓取安全，并补齐浮层的键盘可访问性。

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
