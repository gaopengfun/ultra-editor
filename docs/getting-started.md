# 快速上手

## 安装

```bash
pnpm add @ultra-editor/vue
```

`@ultra-editor/core` 会作为依赖自动装上。

要求：Vue `^3.4`，Node `^20.19 || >=22.12`。

## 最小可用

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

`v-model` 绑定的是 HTML 字符串。编辑器内容变化时会 `emit('update:modelValue', html)`。

## 接上你的图片上传

不接的话图片会内联成 base64 —— demo 够用，生产不行。

```vue
<script setup lang="ts">
import type { UploadHandler } from '@ultra-editor/vue';

const upload: UploadHandler = async (blob, filename) => {
  const form = new FormData();
  form.append('file', blob, filename ?? 'image.png');

  const res = await fetch('/api/upload/image', {
    method: 'POST',
    body: form,
    credentials: 'include'
  });
  if (!res.ok) throw new Error('upload failed');

  const data = await res.json();
  return data.url;   // 必须返回可访问的图片 URL
};
</script>

<template>
  <UltraEditor v-model="html" :upload="upload" :max-image-size="5 * 1024 * 1024" />
</template>
```

抛出异常即视为上传失败，编辑器会移除占位符并弹出提示 —— 文档里不会留下任何残留。

### fetchImage

旋转和裁切需要把已有图片重新取回来编码。默认用 `fetch(src, { credentials: 'include' })`。如果你的图床需要特殊鉴权：

```vue
<UltraEditor :fetch-image="(src) => myApi.getBlob(src)" />
```

> 图片必须能被同源取回（或带正确的 CORS 头），否则 canvas 会被污染，导出时报错。

## 接上 AI

见 [AI Provider 接入](./ai-providers.md)。一句话版本：

```vue
<script setup lang="ts">
import { createOpenAIProvider } from '@ultra-editor/core/providers/openai';

const provider = createOpenAIProvider({ baseURL: '/api/ai', model: 'deepseek-chat' });
</script>

<template>
  <UltraEditor v-model="html" :ai="{ provider }" />
</template>
```

## 渲染保存后的内容

编辑态和阅读态用同一份 CSS：

```vue
<script setup lang="ts">
import '@ultra-editor/core/content.css';
</script>

<template>
  <article class="ue-content" v-html="article.content" />
</template>
```

> `v-html` 渲染的是你自己后端存的内容。编辑器已经在序列化时拦掉了 `javascript:` 之类的危险协议，但如果内容来源不完全可信（例如允许他人投稿），服务端仍应做一次 sanitize —— 前端的过滤永远只是纵深防御的一层。

## 深色模式

```html
<html data-theme="dark">
```

不设置则跟随系统 `prefers-color-scheme`。

属性必须放在 `<html>` 上：菜单和对话框会 Teleport 到 `<body>`，放在更深的元素上够不着它们。

## 校验一切正常

```bash
pnpm dev        # playground，内置模拟 AI，不需要 API Key
```
