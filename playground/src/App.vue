<script setup lang="ts">
import { computed, defineAsyncComponent, defineComponent, h, ref, watchEffect } from 'vue';
import type { AIProvider, LocaleName } from '@ultra-editor/vue';
import { createOpenAIProvider } from '@ultra-editor/core/providers/openai';

const EditorLoading = defineComponent({
  name: 'EditorLoading',
  setup: () => () =>
    h('div', { class: 'pg-editor-state', role: 'status', 'aria-label': '正在加载编辑器' }, [
      h('span', { class: 'pg-editor-spinner', 'aria-hidden': 'true' })
    ])
});

const EditorLoadError = defineComponent({
  name: 'EditorLoadError',
  setup: () => () =>
    h('div', { class: 'pg-editor-state pg-editor-state--error', role: 'alert' }, [
      h('span', '编辑器加载失败'),
      h(
        'button',
        { type: 'button', class: 'pg-editor-retry', onClick: () => window.location.reload() },
        '重试'
      )
    ])
});

const UltraEditor = defineAsyncComponent({
  loader: () => import('@ultra-editor/vue').then((module) => module.UltraEditor),
  loadingComponent: EditorLoading,
  errorComponent: EditorLoadError,
  delay: 0,
  timeout: 15_000,
  onError(_error, retry, fail, attempts) {
    if (attempts < 2) retry();
    else fail();
  }
});

const html = ref(`
<h2>ultra-editor</h2>
<p>一个 <strong>AI Native</strong> 的富文本编辑器，基于 Tiptap 构建。试试这些：</p>
<ul>
  <li>输入 <code>/</code> 唤起命令面板</li>
  <li>选中一段文字，气泡菜单里点 AI</li>
  <li>拖一张图片进来，或者直接粘贴</li>
  <li>插入表格后右击单元格</li>
</ul>
<blockquote><p>没有配置 AI Provider 时，编辑器依然是一个完整的富文本编辑器。</p></blockquote>
`);

const locale = ref<LocaleName>('zh-CN');
const dark = ref(false);
const editable = ref(true);
const ghostText = ref(false);

// The theme attribute belongs on <html>: menus and dialogs are teleported to
// <body>, so anything deeper would not reach them.
watchEffect(() => {
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
});

/* AI ------------------------------------------------------------------------ */

const baseURL = ref('https://api.openai.com/v1');
const apiKey = ref('');
const model = ref('gpt-4o-mini');
const useMock = ref(true);

/**
 * Mock provider — lets the whole AI surface be exercised with no key and no
 * network. It streams a canned reply word by word, on a timer.
 */
const mockProvider: AIProvider = {
  async *stream(request, signal) {
    const reply =
      request.task === 'translate'
        ? 'This is a mocked translation streamed back word by word so you can watch the panel fill in.'
        : `【${request.task}】这是一段模拟的 AI 输出，逐字流式返回，用来演示生成中断、重试与接受的完整链路。你可以随时点击停止，或者接受这段内容把它写进文档。`;

    for (const char of reply) {
      if (signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, 24));
      yield char;
    }
  }
};

const provider = computed<AIProvider | null>(() => {
  if (useMock.value) return mockProvider;
  if (!apiKey.value) return null;
  return createOpenAIProvider({
    apiKey: apiKey.value,
    baseURL: baseURL.value,
    model: model.value
  });
});

/* Upload -------------------------------------------------------------------- */

/**
 * Demo upload handler: hold the blob in memory and hand back an object URL.
 * Real apps POST to their own endpoint and return the stored URL instead.
 */
const upload = async (file: Blob) => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return URL.createObjectURL(file);
};
</script>

<template>
  <div class="pg-root">
    <main class="pg">
      <header class="pg-head">
        <h1>ultra-editor <small>playground</small></h1>
        <div class="pg-controls">
          <label><input v-model="dark" type="checkbox" /> 深色</label>
          <label><input v-model="editable" type="checkbox" /> 可编辑</label>
          <label><input v-model="ghostText" type="checkbox" /> 幽灵补全</label>
          <label><input v-model="useMock" type="checkbox" /> 模拟 AI</label>
          <select v-model="locale">
            <option value="zh-CN">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </header>

      <section v-if="!useMock" class="pg-ai-config">
        <input v-model="baseURL" placeholder="baseURL" />
        <input v-model="model" placeholder="model" />
        <input v-model="apiKey" type="password" placeholder="apiKey（仅本地调试）" />
      </section>

      <!-- `debounce` is what a real app should do with a document of any size, and
           this page needs it twice over: every emit re-renders the HTML dump and
           re-parses the whole document into the read-only preview below, so at 0 the
           playground felt slower than the editor actually is. -->
      <UltraEditor
        v-model="html"
        :locale="locale"
        :editable="editable"
        :upload="upload"
        :ai="{ provider, ghostText, slash: true }"
        :debounce="150"
        min-height="360px"
      />

      <details class="pg-output">
        <summary>输出 HTML</summary>
        <pre>{{ html }}</pre>
      </details>

      <section class="pg-preview">
        <h2>只读渲染（复用同一份 content.css）</h2>
        <div class="ue-content" v-html="html" />
      </section>
    </main>
  </div>
</template>
