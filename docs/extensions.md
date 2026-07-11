# 扩展开发

ultra-editor 就是一组 Tiptap 扩展。Tiptap / ProseMirror 的全部能力在这里都成立，没有额外的抽象层要学。

## 加一个自己的扩展

`createUltraKit()` 返回的是普通数组，直接拼：

```ts
import { Editor } from '@tiptap/core';
import { createUltraKit } from '@ultra-editor/core';
import Mention from '@tiptap/extension-mention';

const editor = new Editor({
  extensions: [
    ...createUltraKit(),
    Mention.configure({
      /* … */
    })
  ]
});
```

Vue 组件层目前没有透传自定义扩展的 prop —— 需要的话用底层实例：

```vue
<script setup lang="ts">
const editorRef = ref<InstanceType<typeof UltraEditor>>();
// editorRef.value.editor 是完整的 Tiptap Editor
</script>
```

> 这是当前的一个缺口，见 [遗留项](#遗留项)。

## 自定义斜杠命令

```ts
import { DEFAULT_SLASH_ITEMS, type SlashItem } from '@ultra-editor/core';

const callout: SlashItem = {
  key: 'callout',
  group: 'insert',
  labelKey: 'toolbar.blockquote', // i18n key；自定义文案用 messages 覆盖
  keywords: ['callout', 'tip', 'tishi'],
  icon: 'quote', // 图标名，见 packages/vue/src/icons.ts
  run: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).toggleBlockquote().run();
  }
};
```

```vue
<UltraEditor :ai="{ provider, slashItems: [...DEFAULT_SLASH_ITEMS, callout] }" />
```

AI 类命令通过注入的 `ai()` 交回宿主 —— core 自己不渲染任何界面：

```ts
{
  key: 'ai-outline',
  group: 'ai',
  labelKey: 'ai.write',
  keywords: ['outline', 'dagang'],
  icon: 'ai',
  run: ({ editor, range, ai }) => {
    editor.chain().focus().deleteRange(range).run();
    ai('custom', '为这篇文章列一个大纲');
  }
}
```

## 复用 AI 生成区域

`AIStream` 把「AI 往文档里写东西」抽成了四个命令。你自己的 AI 功能可以直接复用，白拿「丢弃不留痕 + 接受只占一步撤销」这套语义：

```ts
editor.commands.aiStreamStart(); // 在光标处开一个生成区（对齐到块边界）
for await (const chunk of myStream()) {
  accumulated += chunk;
  editor.commands.aiStreamSet(accumulated); // 幂等，重复渲染累积文本
}
editor.commands.aiStreamAccept(); // 或 aiStreamDiscard()
```

它的实现有两处不那么显然、但很关键：

1. **生成区对齐到块边界。** 在行内光标处塞入段落节点，ProseMirror 会把宿主块劈开来容纳它 —— 于是被追踪的范围之外多出一段孤儿内容，丢弃时删不干净。所以 `aiStreamStart` 会把目标归一化到「当前块之后」（块非空）或「替换当前块」（块为空）。

2. **流式写入不进历史栈。** 每个 chunk 一个事务，若都进历史，撤销一次 AI 生成要按上百次 `Ctrl+Z`。所以写入时 `addToHistory: false`，接受时先无痕回滚、再作为一个普通编辑重放一次。

## 编写 Node 扩展的几条约定

看一眼 `packages/core/src/extensions/` 里的实现，都遵守这些：

**命令要改的是传进来的 `tr`，不是自己新建的。**

```ts
// ✗ 什么都不会发生 —— Tiptap 的 dispatch 只是一个标记
addCommands() {
  return {
    myCommand: () => ({ state, dispatch }) => {
      const tr = state.tr.insertText('hi');
      dispatch(tr);                        // 不生效
      return true;
    }
  };
}

// ✓ 修改 props 里的 tr，Tiptap 会在命令结束后 dispatch 它
addCommands() {
  return {
    myCommand: () => ({ tr, dispatch }) => {
      if (dispatch) tr.insertText('hi');
      return true;
    }
  };
}
```

`dispatch` 为 `undefined` 表示这是一次 `can()` 探测 —— 此时只判断可行性，不要改文档。

**NodeView 里每次操作都要重新解析位置。**

```ts
const current = () => {
  const pos = typeof getPos === 'function' ? getPos() : null;
  if (pos == null) return null;
  const node = editor.state.doc.nodeAt(pos);
  return node?.type.name === 'columnBlock' ? { pos, node } : null;
};
```

闭包里捕获的 `node` / `pos` 会在上方内容变动后失效。

**NodeView 的按钮要在 `mousedown` 上 `preventDefault`。**

否则点击时编辑器先失焦、选区跳走，`click` 处理器拿到的已经是错的状态。

**碰 `document` / `window` 前先过 SSR guard。**

```ts
import { isBrowser } from '@ultra-editor/core';
if (!isBrowser()) return null;
```

## 图标

`packages/vue/src/icons.ts` 导出一个 `Record<string, string>`，值是 `<svg viewBox="0 0 24 24">` 的内层标记。描边跟随 `currentColor`。加一个：

```ts
import { ICONS } from '@ultra-editor/vue';
ICONS.myIcon = '<circle cx="12" cy="12" r="8"/>';
```

## 遗留项

- Vue 组件层还没有 `extensions` prop 用于透传自定义扩展。目前只能通过 `editorRef.value.editor` 拿底层实例，或直接用 `createUltraKit()` 自己 new 一个 Editor。
