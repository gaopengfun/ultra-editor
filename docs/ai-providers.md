# AI Provider 接入

## 契约

整个 AI 体系只有一个接口：

```ts
interface AIProvider {
  stream(request: AIRequest, signal: AbortSignal): AsyncIterable<string>;
}

interface AIRequest {
  task: AITask; // continue | improve | translate | summarize | rewrite |
  // expand | shorten | fixGrammar | changeTone |
  // complete | write | custom
  text: string; // 选区文本（生成类任务为空）
  context?: string; // 光标前的正文，续写 / 补全靠它
  instruction?: string; // 目标语言、语气、自定义指令
  locale?: string; // 文档语言
}
```

约定两条：

1. **yield 的是增量（delta），不是累积快照。**
2. **必须尊重 `signal`。** 用户点「停止」时，生成器应停止拉取网络并返回。

实现了它，斜杠命令的 AI 项、选区气泡菜单、文档内流式生成、幽灵补全就全部可用。编辑器永远不知道背后是哪家模型。

## 内置适配器

作为可选 subpath 导出，不 import 就会被 tree-shake 掉。

### OpenAI 兼容

覆盖生态里绝大多数服务：OpenAI、DeepSeek、Kimi、通义、Ollama、vLLM，以及你自己的代理。

```ts
import { createOpenAIProvider } from '@ultra-editor/core/providers/openai';

const provider = createOpenAIProvider({
  baseURL: '/api/ai', // 你的后端代理
  model: 'deepseek-chat',
  temperature: 0.7,
  maxTokens: 2048
});
```

### Anthropic

```ts
import { createAnthropicProvider } from '@ultra-editor/core/providers/anthropic';

const provider = createAnthropicProvider({
  baseURL: '/api/anthropic',
  model: 'claude-sonnet-5'
});
```

## ⚠️ 不要把 API Key 放进浏览器

```ts
// 别这么干 —— 任何人打开 devtools 都能拿走这个 key
createOpenAIProvider({ apiKey: 'sk-...' });
```

`apiKey` 选项存在只是为了本地调试方便。生产环境请把 `baseURL` 指向你自己的后端端点：

```ts
// 前端
createOpenAIProvider({ baseURL: '/api/ai' });
```

```ts
// 后端（Node 示例）：持有密钥，转发流
app.post('/api/ai/chat/completions', async (req, res) => {
  const upstream = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` // 密钥只在服务端
    },
    body: JSON.stringify(req.body)
  });

  res.setHeader('Content-Type', 'text/event-stream');
  Readable.fromWeb(upstream.body).pipe(res);
});
```

顺带你还能在这一层做鉴权、限流和用量统计 —— 这些本来也不该交给浏览器。

## 写一个自定义 Provider

任何能吐字符串流的东西都行：

```ts
import type { AIProvider } from '@ultra-editor/core';

const myProvider: AIProvider = {
  async *stream(request, signal) {
    const res = await fetch('/api/my-llm', {
      method: 'POST',
      signal, // 把中断信号透传下去
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request) // 后端自己决定 prompt
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      yield decoder.decode(value, { stream: true }); // 增量
    }
  }
};
```

把 `AIRequest` 原样发给后端，prompt 的措辞就完全由服务端掌控 —— 想换模型、调 prompt、加 RAG，前端一行都不用动。

## 自定义 prompt

不想动后端、只想改措辞，覆盖 `promptFor`：

```ts
import { promptFor } from '@ultra-editor/core';

createOpenAIProvider({
  baseURL: '/api/ai',
  promptFor: (request) => {
    if (request.task === 'improve') {
      return {
        system: '你是一个技术博客编辑，风格简洁克制，不用形容词堆砌。',
        user: `润色这段话：\n\n${request.text}`
      };
    }
    return promptFor(request); // 其余走默认
  }
});
```

## 幽灵补全的成本

`ghostText` **默认关闭**，因为它在用户停止输入后自动发请求 —— 没人主动要求，token 却在烧。

打开时建议调大 `ghostDelay`：

```vue
<UltraEditor :ai="{ provider, ghostText: true, ghostDelay: 1500 }" />
```

补全用的是 `complete` 任务，prompt 里限定了「只补当前这句、20 词以内」，请求本身很短。
