---
'@ultra-editor/core': patch
---

未指定语言的代码块不再猜语言，「PlainText」现在真的是纯文本

上游的 lowlight 插件在 `language` 为空时会退回 `highlightAuto()`,而语言选择器把这种块标成「PlainText」。两件事对不上:标签承诺不高亮,渲染出来却是猜出来的高亮。

而且猜得不准。拿 10 段典型片段实测,**5 段判错**:JavaScript 箭头函数判成 `ini`(于是结尾的 `;` 被涂成注释色)、Go 判成 `csharp`、Java 判成 `typescript`、HTML 判成 `php-template`、Bash 判不出来。人们贴进代码块的片段大多就是这个长度,猜错是常态而非例外。

现在把注入的 lowlight 实例包一层、只关掉 `highlightAuto`,让标签说到做到:未指定语言 = 不高亮。显式选了语言的块走 `highlight()`,行为完全不变。包装用原型委托而非拷贝,`loadCommonLanguages` 之后注册进来的语法照样可见。

`data-language` 与 Markdown 围栏的信息串都不受影响——文档里存的仍然是"没有语言",不会凭空多出 `plaintext`。
