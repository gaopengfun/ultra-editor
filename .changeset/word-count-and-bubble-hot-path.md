---
'@ultra-editor/vue': patch
'@ultra-editor/core': patch
---

优化输入时的每次事务开销：字数统计不再全文跑正则，气泡菜单不再重复测量。

`@tiptap/vue-3` 把编辑器 state 包成响应式 ref，**每个事务都会重新发布**——包括纯光标移动。于是状态栏的字数统计每次都重跑一遍：`getText()` 拿到全文后，`replace(/\s/g)` 复制一份文档、`match(/[一-龥]/g)` 生成一个「每个汉字一个字符串」的数组、再 `replace` + `match` 一次。157 KB 文档上实测单次 3.0 ms，方向键移动光标也照付。现在按文档对象缓存（光标移动直接复用上次结果），统计本身也改成按 char code 的单趟扫描，实测 0.43 ms，快 7 倍。空白字符集与单词字符集已对 BMP 全部 65536 个码位逐一比对过，与原正则完全等价——包括扩展区汉字仍不计入这一既有行为。

气泡菜单同时监听了 `transaction` 和 `selectionUpdate`。Tiptap 对同一次 dispatch 先发前者、紧接着发后者，所以选区一动 `update()` 就跑两遍，每遍两次 `coordsAtPos`——而 `coordsAtPos` 会强制同步布局。只留 `transaction` 即可，它是前者的严格超集。

Markdown 序列化里代码块的围栏计算把 `node.textContent` 当循环条件用，而它是每次访问都从子节点重建字符串的 getter，一个代码块要重建 2~3 次。改为只读一次。
