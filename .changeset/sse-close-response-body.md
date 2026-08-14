---
'@ultra-editor/core': patch
---

修复 `readSSE` 提前退出时不关闭响应体。

此前提前退出只 `releaseLock` 不 `cancel`，响应体不会关闭。两个内置 provider 都在 `[DONE]` / `message_stop` 处 `return`，所以每一次 AI 请求都走这条路径。
