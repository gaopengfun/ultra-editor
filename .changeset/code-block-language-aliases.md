---
'@ultra-editor/core': minor
'@ultra-editor/vue': minor
---

代码块语言选择器补上 TOML 和 HTML

选择器的列表来自 `lowlight.listLanguages()`,而它返回的是注册的语法**名**。
highlight.js 把 TOML 归在 `ini` 下、HTML 归在 `xml` 下,两者都只是别名,于是这两个
语言从来没能出现在下拉里 —— 尽管 `highlight('toml', …)` 本身完全正常。净效果是
写 TOML 的人只能把自己的块标成「INI」,写 HTML 的人只能标成「XML」。

现在按别名单独列出,以「该语法确实注册了」为前提:宿主自带语言集时,不会被塞进一个
点了也画不出高亮的选项。

高亮结果与 `ini` / `xml` 完全一致 —— 同一份语法,区别只在 `language` 属性和显示
标签,以及 Markdown 围栏的信息串是 `toml` 还是 `ini`。这正是作者的本意,应当保留。
