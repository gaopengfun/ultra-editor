---
'@ultra-editor/core': patch
---

代码块语言选择器里的默认项，中文语境下由「纯文本」改为 `PlainText`。

那个下拉列出的是 highlight.js 的语言名（JavaScript、CSS、Rust……），到哪个语言环境都是专有名词、不翻译，「纯文本」是其中唯一一个读起来像中文的条目。英文语境保持 `Plain text` 不变 —— 那里本来就是英文，改成驼峰只会更别扭。
