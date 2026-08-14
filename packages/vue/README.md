# @ultra-editor/vue

**AI Native 富文本编辑器，Vue 3 组件。基于 Tiptap 构建。**

> **⚠️ 尚未发布到 npm。** 下面的命令要等首次发布之后才可用。

```bash
pnpm add @ultra-editor/vue
```

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

开箱即用：图片（旋转 / 裁切 / 8 锚点缩放 / 对齐 / 图注 / 粘贴拖拽上传）、可拖拽行列的表格、分栏卡片、代码高亮、深浅色主题、中英文 i18n。**零 UI 依赖** —— 对话框、toast、取色器、裁切器全部自建。

配一个 `AIProvider` 即可点亮 AI：斜杠命令、选区气泡菜单、文档内流式生成、`Tab` 接受的幽灵补全。不绑定任何厂商。

```vue
<UltraEditor v-model="html" :ai="{ provider }" :upload="myUploadHandler" />
```

📖 **完整文档：** https://github.com/gaopengfun/ultra-editor

## License

MIT
