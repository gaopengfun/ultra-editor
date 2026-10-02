---
'@ultra-editor/core': patch
---

修复列表标记在带 CSS reset 的宿主项目里全部消失的问题。

`content.css` 对 `ul` / `ol` 只声明了 `margin` 和 `padding-left`，从未显式写 `list-style-type`，圆点和数字一直依赖浏览器默认样式。而 Tailwind preflight 这类 reset 会对每个 `ul` / `ol` 设 `list-style: none`：`.ue-content ul` 的优先级足够把间距赢回来，`list-style: none` 却没有任何规则去对抗 —— 于是宿主页面里的列表标记一个不剩，有序和无序列表看起来跟普通段落一模一样，工具栏按钮像是没有生效。

现在 `ul` 显式 `list-style-type: disc`、`ol` 显式 `list-style-type: decimal`，嵌套无序列表按 disc → circle → square 递进。content.css 本来就是「文档外观的唯一事实来源」，标记样式不该外包给 UA 默认值。
