<div align="center">

# ultra-editor

**AI Native 富文本编辑器，基于 Tiptap 构建。**

斜杠命令 · 选区 AI 气泡菜单 · 文档内流式生成 · 幽灵文本补全
图片编辑（旋转 / 裁切 / 8 锚点缩放 / 对齐 / 图注）· 分栏卡片 · 可拖拽行列的表格

[![CI](https://github.com/penggao4/ultra-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/penggao4/ultra-editor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ultra-editor/vue.svg)](https://www.npmjs.com/package/@ultra-editor/vue)
[![license](https://img.shields.io/npm/l/@ultra-editor/vue.svg)](./LICENSE)

</div>

---

## 它是什么

一个可以直接装进任何 Vue 3 项目的编辑器 SDK。AI 不是挂在工具栏上的一个按钮，而是从斜杠命令、选区气泡、行内补全三条路径长进编辑流里。

同时它不绑定任何 AI 厂商、不绑定任何 UI 框架、不绑定任何上传后端 —— 这三件事都是你注入的。

## 安装

```bash
pnpm add @ultra-editor/vue
```

`@ultra-editor/core`（框架无关的扩展与 AI 引擎）会作为依赖一并装上。只写自定义扩展、或要接 React/Svelte，可以只装 core。

## 30 秒上手

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { UltraEditor } from '@ultra-editor/vue';
import '@ultra-editor/core/styles.css';

const html = ref('<p>开始写点什么…</p>');
</script>

<template>
  <UltraEditor v-model="html" />
</template>
```

到这里你已经有一个完整的富文本编辑器了：图片、表格、分栏、代码块、撤销重做、深浅色主题全都在，**没有配置 AI 也完全可用**。

代码块自带 37 种主流语言的下拉选择和语法高亮，这些解析器不进主包，而是挂载后作为独立 chunk 异步加载；想自己掌控语言集，传 `lowlight` prop 即可。

## 接上 AI

AI 的全部契约就是一个 `stream` 方法：

```ts
interface AIProvider {
  stream(request: AIRequest, signal: AbortSignal): AsyncIterable<string>;
}
```

实现它，斜杠命令里的 AI 项、选区气泡菜单、流式生成、幽灵补全就一起亮起来。SDK 永远不知道你用的是哪家模型。

内置两个适配器（可选 subpath 导出，不用则会被 tree-shake 掉）：

```ts
import { createOpenAIProvider } from '@ultra-editor/core/providers/openai';
import { createAnthropicProvider } from '@ultra-editor/core/providers/anthropic';

// OpenAI 协议兼容 —— DeepSeek / Kimi / 通义 / Ollama / vLLM 都能直接用
const provider = createOpenAIProvider({
  baseURL: '/api/ai', // 指向你自己的后端代理
  model: 'deepseek-chat'
});
```

```vue
<UltraEditor v-model="html" :ai="{ provider, ghostText: true }" />
```

> **⚠️ 不要把 API Key 放进浏览器。**
> 任何人打开 devtools 都能拿走它。生产环境请让 `baseURL` 指向你自己的后端端点，由后端持有密钥转发请求。`apiKey` 选项只是为了本地调试方便。

### AI 的三条路径

| 路径         | 触发       | 行为                                                                                     |
| ------------ | ---------- | ---------------------------------------------------------------------------------------- |
| **斜杠命令** | 输入 `/`   | 命令面板，普通块与 AI 动作并列                                                           |
| **选区气泡** | 选中文字   | 润色 / 翻译 / 总结 / 改写 / 扩写 / 缩写 / 修正语法 / 调整语气 / 自定义指令               |
| **幽灵补全** | 停止输入后 | 灰色行内建议，`Tab` 接受，`Esc` 忽略（**默认关闭**，因为它会在你没主动要求时消耗 token） |

生成过程随时可以**停止**、**重试**、**丢弃**。

**接受一次生成 = 一步撤销。** 流式写入不进历史栈，接受时才作为一个普通编辑重放一次 —— 所以 `Ctrl+Z` 一次就能撤销整段 AI 内容，而不是一个字一个字往回退；丢弃则不留任何痕迹。

## 图片上传

SDK 里没有 axios、没有 URL、没有鉴权逻辑。只有一个函数：

```ts
type UploadHandler = (file: Blob, filename?: string) => Promise<string>;
```

```vue
<UltraEditor v-model="html" :upload="(blob, name) => myApi.upload(blob, name).then((r) => r.url)" />
```

不传 `upload` 时会退化成 base64 data URL —— demo 能跑，但**不要用在生产环境**：一张 2MB 的图会变成 2.7MB 的 base64 塞进你的 HTML。

支持点击工具栏、**粘贴**、**拖拽** 三种方式插入图片。插入后右击图片可以旋转 / 裁切 / 对齐 / 加图注，选中后八个锚点可拖拽缩放。

## 主题定制

所有样式变量都以 `--ue-` 开头且自带兜底值，覆盖即换肤：

```css
:root {
  --ue-primary: #5b5bd6;
  --ue-radius-md: 12px;
  --ue-surface: #fff;
}
```

深色模式跟随 `prefers-color-scheme`，也可以在 `<html>` 上显式指定：

```html
<html data-theme="dark"></html>
```

> 主题属性必须放在 `<html>` 上。菜单和对话框会 Teleport 到 `<body>`，放在更深的元素上够不着它们。

完整变量表见 [主题文档](./docs/theming.md)。

## 编辑态与阅读态共用一份样式

文章详情页把存下来的 HTML 包一层 `ue-content` 就行，和编辑器里长得一模一样：

```vue
<div class="ue-content" v-html="article.content" />
```

```ts
import '@ultra-editor/core/content.css'; // 只要内容样式，不含编辑器工具栏
```

这是刻意的设计：编辑态和阅读态是**同一份 CSS**，不存在两边手抄然后慢慢漂移的问题。

## 文档

- [快速上手](./docs/getting-started.md)
- [API 参考](./docs/api.md)
- [AI Provider 接入](./docs/ai-providers.md)
- [主题定制](./docs/theming.md)
- [扩展开发](./docs/extensions.md)

## 本地开发

```bash
pnpm install
pnpm dev          # 启动 playground（含模拟 AI，无需 API Key）
pnpm verify       # lint + type-check + test + build
```

## 包结构

| 包                   | 作用                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------- |
| `@ultra-editor/core` | 框架无关：Tiptap 扩展、AI 引擎、样式表。React / Svelte 适配器可直接复用                 |
| `@ultra-editor/vue`  | Vue 3 组件层：`UltraEditor.vue` + 零依赖 UI（对话框 / toast / 取色器 / 裁切器全部自建） |

## License

MIT
