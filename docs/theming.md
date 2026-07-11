# 主题定制

## 原理

所有样式变量都以 `--ue-` 开头，声明在 `:root` 上，且**都带兜底值**。覆盖变量即可换肤，不需要改一行样式表、不需要 `!important`。

```css
:root {
  --ue-primary: #16a34a;
  --ue-radius-md: 4px;
}
```

变量声明在 `:root` 而不是 `.ultra-editor` 上，是因为菜单、对话框、toast 都会 Teleport 到 `<body>` —— 挂在编辑器元素上的话，这些浮层会全部失去背景色变成透明。

## 深色模式

跟随系统：什么都不用做。

显式指定：

```html
<html data-theme="dark">   <!-- 或 "light" -->
```

> **属性必须放在 `<html>` 上。** 放在 `#app` 或某个 wrapper 上，编辑器本体会变深色，但 Teleport 到 body 的菜单和对话框够不着，会留在浅色。

## 完整变量表

### 颜色

| 变量 | 默认（浅色） | 默认（深色） |
|------|-------------|-------------|
| `--ue-primary` | `#5b5bd6` | `#c4c0ff` |
| `--ue-primary-rgb` | `91 91 214` | `196 192 255` |
| `--ue-on-primary` | `#ffffff` | `#23204d` |
| `--ue-accent` | `#1f7ae0` | `#7fc4ff` |
| `--ue-surface` | `#ffffff` | `#16151a` |
| `--ue-surface-container` | `#f4f4f8` | `#1e1d24` |
| `--ue-surface-container-high` | `#ececf2` | `#26252d` |
| `--ue-hover` | `primary / 8%` | `primary / 12%` |
| `--ue-text` | `#1c1b1f` | `#e6e1e9` |
| `--ue-text-secondary` | `#49454f` | `#cac4d0` |
| `--ue-text-muted` | `#79747e` | `#948f99` |
| `--ue-text-placeholder` | `#a9a4b3` | `#6b6673` |
| `--ue-border` | `#e2e2ea` | `#322f39` |
| `--ue-danger` | `#d3302f` | `#ff8a80` |
| `--ue-danger-rgb` | `211 48 47` | `255 138 128` |
| `--ue-code-bg` | `#1e2233` | `#0f1220` |
| `--ue-code-fg` | `#e6e6f0` | 同 |
| `--ue-inline-code` | `#b5297f` | `#ff9ad5` |

### ⚠️ `--ue-primary-rgb` 必须是**空格分隔**

`--ue-primary-rgb` / `--ue-danger-rgb` 是裸通道值，SDK 内部用现代斜杠语法计算透明度：

```css
background: rgb(var(--ue-primary-rgb) / 8%);
```

所以它们必须写成 **`91 91 214`**（空格），不能是 `91, 91, 214`（逗号）。

很多设计系统里的 `--xxx-rgb` 是逗号分隔的。**直接 alias 过来会静默失效**：

```css
/* ✗ 展开后是 rgb(81, 165, 220 / 8%) —— 非法，整个值变透明。
   悬停底色、单元格选中高亮、AI 生成区高亮、聚焦光晕会全部消失，且不报任何错。 */
--ue-primary-rgb: var(--my-primary-rgb);

/* ✓ 用空格重新写一遍 */
--ue-primary-rgb: 81 165 220;
```

**改 `--ue-primary` 时记得一起改它**，否则半透明效果还会用旧色。

### 形状与阴影

| 变量 | 默认 |
|------|------|
| `--ue-radius-xs` / `sm` / `md` / `lg` | `4px` / `8px` / `12px` / `16px` |
| `--ue-shadow-1` / `2` / `3` | 由浅到深的三级投影 |
| `--ue-shadow-glow` | 聚焦时的主色光晕 |

### 动效

| 变量 | 默认 |
|------|------|
| `--ue-ease` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ue-duration-fast` | `120ms` |
| `--ue-duration` | `200ms` |

`prefers-reduced-motion: reduce` 时所有过渡会自动关闭。

### 排版与尺寸

| 变量 | 默认 |
|------|------|
| `--ue-font` | `inherit`（默认跟随宿主页面字体） |
| `--ue-font-mono` | 系统等宽字体栈 |
| `--ue-min-height` | `500px` |
| `--ue-max-height` | `70vh` |

高度也可以直接用 props：`<UltraEditor min-height="300px" max-height="60vh" />`。

## 接进已有设计系统

把 `--ue-*` 映射到你自己的 token 就行。例如接进一套 Material Design 3 变量：

```css
:root {
  --ue-primary: var(--md-primary);
  --ue-primary-rgb: var(--md-primary-rgb);
  --ue-on-primary: var(--md-on-primary);
  --ue-surface: var(--bg-surface);
  --ue-surface-container: var(--bg-surface-container);
  --ue-surface-container-high: var(--bg-surface-container-high);
  --ue-text: var(--color-text-primary);
  --ue-text-muted: var(--color-text-muted);
  --ue-border: var(--color-border);
  --ue-radius-md: var(--md-shape-md);
  --ue-shadow-1: var(--md-elevation-1);
  --ue-shadow-2: var(--md-elevation-2);
  --ue-ease: var(--md-easing-standard);
}
```

之后你的主题切换逻辑改的是自己的 token，编辑器会跟着一起变。

## 两份样式表

| 引入 | 内容 | 用在哪 |
|------|------|--------|
| `@ultra-editor/core/styles.css` | 全部：tokens + 内容样式 + 编辑器界面 + AI 界面 | 有编辑器的页面 |
| `@ultra-editor/core/content.css` | tokens + 内容样式 | 只读渲染页（文章详情等） |

阅读态把内容包一层 `ue-content` 即可：

```html
<article class="ue-content" v-html="article.content"></article>
```

编辑器的正文区本身也带 `ue-content` 类 —— **编辑态和阅读态是同一份 CSS**，不会各写一份然后慢慢长歪。
