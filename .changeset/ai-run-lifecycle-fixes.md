---
'@ultra-editor/core': patch
'@ultra-editor/vue': patch
---

修复 AI 面板重开与重试时旧生成未被中止的问题，并补齐全量单元测试。

**修复**

- 在一次生成尚未结束时再次发起（`start` / `submit`），旧的 `AIRun` 会被直接丢弃而不中止：它的流继续拉取、继续计费，`onChunk` 也继续往共享面板状态里写，`stop()` 之后只能中止最新的那一次。`useAi` 内部改为统一走 `abandon()`——换掉一次生成之前必定先 `abort()`。`transform` 模式下编辑器不上锁、气泡菜单仍然可用，从 UI 上就能触发。
- 「重试」会让面板停在「已完成」，而新的生成还在流式写入：`retry()` 先 `abort()` 再同步 `execute()`，但中止要到下一个微任务才落地，于是那次已经作废的生成的 `onAbort` 反而把 `phase` 又改回了 `done`——用户会在还在生成时看到接受 / 丢弃按钮。作废的生成现在带世代号，落后的回调不再写入当前状态。

**内部**

- `createUltraKit` 的 `upload.fetchImage` 没有任何扩展会读取：重新编码已有图片属于外壳的职责，旋转与裁切直接调用 `upload.fetchImage`。`UltraEditor` 不再把它透传进 kit。
