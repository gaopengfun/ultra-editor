---
'@ultra-editor/vue': patch
---

修复斜杠命令面板在视口下方被截断，AI 分组点不到

面板位置原先按两个写死的尺寸估算来夹:`Math.min(rect.left, innerWidth - 280)` 和 `Math.min(rect.bottom + 6, innerHeight - 320)`。但面板高度是随内容变的——接了 AI Provider 之后是 12 个条目加 3 个分组标题,实测 478px,那个 320 的估值根本夹不住。861px 高的窗口里在文档下半部分敲 `/`,面板底部落在 945px,**超出视口 84px**,「续写」「AI 写一段」既点不到也滚不到。

改成面板自己测量后再夹:`useFloating` 里那段夹取逻辑抽成 `clampToViewport(anchor, rect)`,`UeSlashMenu` 渲染后量一次自己的实际尺寸再定位,`UltraEditor` 只负责给光标锚点。因为是实测,输入关键词把列表筛短之后面板还会跟着回到光标附近——写死的常量做不到这件事。

同一段夹取逻辑此前在 `useFloating` 和 `UltraEditor` 里各有一份且互不一致,现在只剩一份。
