# 从内置 Tiptap 迁移

这份指南来自一次真实迁移 —— ultra-editor 就是从 [blog-next](https://www.gaopeng.fun) 里拆出来的。下面每一条都是那次拆分里真的踩到的。

## 迁移前后

|            | 之前                                                                                 | 之后                     |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------ |
| 编辑器组件 | `src/components/TiptapEditor.vue`（1165 行）+ `src/components/tiptap/*`（11 个文件） | `<UltraEditor>`          |
| UI 依赖    | Element Plus + vue-advanced-cropper                                                  | 无                       |
| 上传       | 组件内写死 `axios.post('/api-blog/upload/image')`                                    | 注入 `upload` 函数       |
| 阅读态样式 | `editorView.css`（262 行，手抄一份编辑态样式）                                       | 复用 SDK 的 `ue-content` |
| 内容绑定   | `ref.getHTML()` 拉取 + `watch(props.content)` 回灌                                   | `v-model`                |

`package.json` 净减 11 个依赖（9 个 `@tiptap/*`、`lowlight`、`vue-advanced-cropper`），换成 2 个 `@ultra-editor/*`。

## 步骤

### 1. 换依赖

```diff
- "@tiptap/core": "^3.26.1",
- "@tiptap/extension-code-block-lowlight": "^3.26.1",
- ...（其余 @tiptap/*）
- "lowlight": "^3.3.0",
- "vue-advanced-cropper": "^2.8.9",
+ "@ultra-editor/vue": "^0.1.0",
```

Tiptap 现在是 SDK 的传递依赖。如果你还有别的地方直接 import `@tiptap/*`，保留它们并确保版本一致。

### 2. 把上传逻辑搬出来

原来埋在编辑器里的上传，现在是你这一侧的一个函数：

```ts
// src/utils/uploadImage.ts
import type { UploadHandler, ImageFetcher } from '@ultra-editor/vue';

export const uploadImage: UploadHandler = async (file, filename = 'image.png') => {
  const formData = new FormData();
  formData.append('file', file, filename);

  const res = await axios.post('/api-blog/upload/image', formData, {
    withCredentials: true,
    headers: { 'X-Token': await ensureAdminToken() }
  });

  const url = res.data?.url ?? res.data?.data?.url;
  if (!url) throw new Error('上传失败');
  return url;
};

// 旋转 / 裁切要把原图取回来重新编码
export const fetchImage: ImageFetcher = async (src) => {
  const res = await axios.get(src, { responseType: 'blob', withCredentials: true });
  return res.data;
};
```

### 3. 换组件

```diff
- <TiptapEditor ref="tiptapEditorRef" :content="form.content.value" />
+ <UltraEditor
+   v-model="form.content.value"
+   :upload="uploadImage"
+   :fetch-image="fetchImage"
+   :debounce="300"
+ />
```

保存时不用再伸手进组件里掏内容：

```diff
- const htmlContent = tiptapEditorRef.value.getHTML();
- await form.save(htmlContent);
+ await form.save(form.content.value);
```

顺带修掉了老实现的一个毛病：`watch(props.content)` 回灌会让光标跳走。`v-model` 内部用 `setContent(value, { emitUpdate: false })` 并保留选区，父组件回写不再打断输入。

### 4. 接上主题

SDK 只认 `--ue-*`。映射到你自己的 token，编辑器就跟着你的主题切换走：

```css
:root {
  --ue-primary: var(--md-primary);
  --ue-surface: var(--bg-surface);
  --ue-border: var(--color-border);
  /* … */
}
```

> **⚠️ `--ue-primary-rgb` 不能直接 alias。**
> SDK 用 `rgb(var(--ue-primary-rgb) / 8%)` 算透明度，要求**空格分隔**（`81 165 220`）。多数设计系统里的 `--xxx-rgb` 是逗号分隔的，直接 alias 会展开成非法的 `rgb(81, 165, 220 / 8%)`，**静默**变透明 —— 悬停底色、单元格高亮、聚焦光晕会全部消失且不报错。用空格重写一遍：
>
> ```css
> --ue-primary-rgb: 81 165 220;
> [data-theme='dark'] {
>   --ue-primary-rgb: 111 192 239;
> }
> ```
>
> 这一条我们自己就踩了。

### 5. 删掉阅读态那份手抄样式

阅读态的 `editorView.css` 本质是编辑态样式的一份拷贝 —— 每加一个新特性（表格行高、分栏卡片）都要抄两遍，然后慢慢长歪。现在直接复用 SDK 的：

```diff
- <style src="@/assets/css/editorView.css"></style>
```

```diff
- <div class="content-body editor-content-view" v-html="article.content" />
+ <div class="content-body ue-content editor-content-view" v-html="article.content" />
```

`editor-content-view` 留着放你自己那些编辑性的点缀（正文衬线体、代码块角标语言徽标），公共部分交给 `ue-content`。

## 老内容会不会挂？

不会。旧版本序列化出来的 `figure.tiptap-figure` / `div.tiptap-columns` / `div.tiptap-column` 三个类名，SDK 的 `parseHTML` 和 `content.css` **都同时认新老两套**：

- 已有文章照常解析、照常渲染，不需要任何数据迁移。
- 重新编辑并保存后，会自然写成新的 `ue-*` 类名。

新老可以长期共存。

## 本地联调（monorepo 之外）

SDK 和宿主项目是两个独立仓库时，用 `link:`：

```json
"@ultra-editor/vue": "link:../ultra-editor/packages/vue"
```

**必须加 dedupe**，否则 Vue 和 ProseMirror 会各存在两份 —— 两份 Vue 意味着跨边界的响应式失效，两份 ProseMirror 意味着编辑器不认自己创建的节点：

```ts
// vite.config.ts
resolve: {
  dedupe: [
    'vue',
    '@tiptap/core',
    '@tiptap/pm',
    '@tiptap/vue-3',
    'prosemirror-model',
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-transform',
    'prosemirror-tables'
  ];
}
```

## 白拿的东西

迁移完成后自动获得：

- **粘贴 / 拖拽上传**（老版本只能点工具栏按钮）
- **图片 `src` 协议校验**（老版本只校验了链接，图片没管）
- **字数统计**、**只读模式**、**中英文 i18n**
- **SSR guard**
- 右键菜单不再依赖打开时缓存的位置 —— 文档变更后不会作用到错误的节点
- 以及整套 AI 能力：配一个 `provider` 就全亮
