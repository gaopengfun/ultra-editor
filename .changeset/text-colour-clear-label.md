---
'@ultra-editor/core': patch
'@ultra-editor/vue': patch
---

修复文字颜色面板里的清除按钮写着「清除底色」

工具栏的颜色面板直接借用了表格菜单的文案键 `table.clearColor`,于是「文字颜色」
面板里那颗按钮写的是「清除底色」——英文更直白,`Text color` 面板里写着
`Clear background`。两个面板改的根本不是同一件事:一个改文字颜色,一个改单元格
背景色。

新增 `toolbar.clearColor`(清除颜色 / Clear color)给文字颜色面板用,表格菜单继续
用 `table.clearColor`。
