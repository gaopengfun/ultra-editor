---
'@ultra-editor/core': patch
---

阅读视图内容容器包含浮动图片、兜底横向溢出。

- `.ue-content` 此前对 `data-align="left|right"` 的 figure/img 只 `float` 不包含：编辑器里靠 `.ultra-editor .ue-content` 的 `overflow-y: auto` 顺带建立 BFC 才没露馅，裸的只读视图（`<div class="ue-content">`）没有这条规则，左/右对齐图片会溢出容器底部、压到后续内容上。
- 现在给 `.ue-content` 加 `overflow-x: auto`：既建立 BFC 包含浮动，又兜底作者插入的超宽内容。编辑器 surface 的 `overflow-x` 本就由 `overflow-y: auto` 隐式置为 `auto`，此处是显式化，无行为变化。
