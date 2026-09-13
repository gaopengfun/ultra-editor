# @ultra-editor/vue

## 1.2.0

### Minor Changes

- 8488fc4: 代码块语言选择器补上 TOML 和 HTML

  选择器的列表来自 `lowlight.listLanguages()`,而它返回的是注册的语法**名**。
  highlight.js 把 TOML 归在 `ini` 下、HTML 归在 `xml` 下,两者都只是别名,于是这两个
  语言从来没能出现在下拉里 —— 尽管 `highlight('toml', …)` 本身完全正常。净效果是
  写 TOML 的人只能把自己的块标成「INI」,写 HTML 的人只能标成「XML」。

  现在按别名单独列出,以「该语法确实注册了」为前提:宿主自带语言集时,不会被塞进一个
  点了也画不出高亮的选项。

  高亮结果与 `ini` / `xml` 完全一致 —— 同一份语法,区别只在 `language` 属性和显示
  标签,以及 Markdown 围栏的信息串是 `toml` 还是 `ini`。这正是作者的本意,应当保留。

- 4766855: 取色器自绘自定义颜色，代码块语言写入 `pre[data-language]`，修掉 Markdown 源码往返多出来的空行。

  **取色器**：自定义颜色原先是一个 `<input type="color">`，色块由浏览器绘制，点开弹出的是浏览器自己的取色面板（直角、系统数字框、系统吸管），和编辑器的设计语言完全两套，且无法改写样式。现在色板 24 色不变，操作条上多一个「自定义」，点开才展开饱和度区、色相条与 hex 输入框，面板默认尺寸不变。拖拽只改草稿，「应用」才写回文档 —— 一次拖拽几十个事件，逐个写会把 undo 栈埋掉。表格右键菜单的底色面板用的是同一个组件，一并受益。core 新增 `hexToHsv` / `hsvToHex` / `normalizeHex` 三个导出。

  **代码块语言**：上游只把语言记在 `<code>` 的 `class` 上，而 `class` 是 HTML 清洗的第一个牺牲品，保存一趟回来语言就没了。现在同时写到 `<pre data-language="…">`，解析时优先读它，读不到再退回 `language-` class —— 旧文档、Markdown 围栏产出的 HTML、外部粘贴的内容都照旧识别。

  **源码模式空行**：四处独立的原因。① 退出源码模式时的空操作守卫比较的是两种 HTML 方言（`markdownToHTML` 写 `<li>文本</li>`，ProseMirror 写 `<li><p>文本</p></li>`），含列表或表格的文档永不相等，于是没改动也照样回写一次，凭空占掉一格 undo；改为在 Markdown 上比较。② 连续两个硬换行时，第二个写出的是一行只有 `  ` 标记的行，而空行正是 Markdown 结束段落的方式，读回来一个段落被劈成两个；无处可断的硬换行现在直接丢弃。③ 列表项里的第二个块，读回来时那个空行被当成列表结束，续段变成顶层段落并把列表劈成两截，`- 一\n\n  续段\n- 二` 往返一次就成了 `- 一\n\n续段\n\n- 二`；空行后跟缩进行现在正确识别为松散列表项的内部分隔。④ 标题和表格单元格在 Markdown 里都只有一行可用，硬换行原样写出会让标题后半截掉成段落、单元格里留下一段空隙，现在连同 `  ` 标记一起折成一个空格。

- bb15507: 新增 Markdown 编辑能力：双向转换、粘贴自动识别、Vue 源码模式。

  - `docToMarkdown(doc)` 与 `markdownToHTML(md)` —— 针对本编辑器 schema 手写的双向转换，不引第三方 Markdown 依赖（`prosemirror-markdown` 认不得表格、图注和分栏）。覆盖标题、段落、加粗 / 斜体 / 删除线 / 行内代码 / 链接、有序与无序列表（含嵌套）、引用、围栏代码块（带语言）、分割线、图片、GFM 表格与硬换行；Markdown 表达不了的（下划线、文字颜色、分栏）降级为纯文本而不是丢失。整套转换约 3.3 KB（gzip）。
  - `MarkdownPaste` 扩展：粘贴纯文本时，只有在内容**明确**是 Markdown（`looksLikeMarkdown`：一个块级语法即可，行内语法需两种以上）才转成富文本。剪贴板带 `text/html` 时让位给 ProseMirror 自己的解析器；代码块内粘贴保持原样。可通过 `markdownPaste` getter 运行时开关，或 `features.markdown: false` 整个摘掉。
  - Vue 组件新增 Markdown 源码模式：工具栏切换后编辑区换成 textarea，退出时套用回文档。源码模式下 textarea 是唯一事实来源（不反向重排作者正在敲的字），编辑内容按 `debounce`（默认 300ms）同步进文档，`v-model` 全程可信；未退出就卸载也会先落盘。
  - Vue 组件新增 `getMarkdown()` / `setMarkdown()`，以及 `markdown` prop（默认开）。
  - 解析器把源码里的裸 HTML 转义而非放行，`javascript:` 链接与非图片 `data:` URL 一律拒绝 —— 从剪贴板来的 Markdown 是不可信输入。
  - 新增文案 `toolbar.markdown` / `markdown.exit` / `markdown.placeholder`（`zhCN` 与 `en`）。

### Patch Changes

- 3d9060e: 修复 AI 面板重开与重试时旧生成未被中止的问题，并补齐全量单元测试。

  **修复**

  - 在一次生成尚未结束时再次发起（`start` / `submit`），旧的 `AIRun` 会被直接丢弃而不中止：它的流继续拉取、继续计费，`onChunk` 也继续往共享面板状态里写，`stop()` 之后只能中止最新的那一次。`useAi` 内部改为统一走 `abandon()`——换掉一次生成之前必定先 `abort()`。`transform` 模式下编辑器不上锁、气泡菜单仍然可用，从 UI 上就能触发。
  - 「重试」会让面板停在「已完成」，而新的生成还在流式写入：`retry()` 先 `abort()` 再同步 `execute()`，但中止要到下一个微任务才落地，于是那次已经作废的生成的 `onAbort` 反而把 `phase` 又改回了 `done`——用户会在还在生成时看到接受 / 丢弃按钮。作废的生成现在带世代号，落后的回调不再写入当前状态。

  **内部**

  - `createUltraKit` 的 `upload.fetchImage` 没有任何扩展会读取：重新编码已有图片属于外壳的职责，旋转与裁切直接调用 `upload.fetchImage`。`UltraEditor` 不再把它透传进 kit。

- 01cb5ff: 修复选区气泡菜单跑到视口外点不到

  气泡的定位只夹了下界:`left: Math.max(12, 中点)`、`top: Math.max(12, 顶部 - 12)`,
  再靠 `translate(-50%, -100%)` 把自己挪到选区上方居中。夹的是**变换之前**的那个点,
  所以变换之后的实际盒子照样可以落在视口外,而且垂直方向上夹了等于没夹——把 top 夹到
  不小于 12 之后,元素又被整体抬高自身高度,结果反而更靠上。

  两个实测后果(360×640、英文界面,气泡宽 242px):

  - 选中视口顶部那一行时,气泡 `top: -26`、高 38 —— 超过一半在屏幕外,加粗、AI 入口
    全都点不到。
  - 选中靠右的表格单元格时,气泡右边超出视口 15px。

  改成量出气泡实际尺寸后再定位:默认放在选区上方,上方放不下就翻到下方(单纯往下夹
  只会把气泡压在它所属的那段文字上),水平方向按实际宽度居中后夹进视口,`transform`
  一并去掉——位置现在就是最终位置。尺寸必须实测:英文比中文宽,接上 AI Provider 又
  更宽,而那正是它开始溢出的时候。

  顺带把 `clampToViewport` 改成两端都夹。此前只夹远端,而居中的调用方(气泡要减去自身
  一半宽度)完全可能递进来负坐标。

  气泡里的 AI 任务列表同样如此:它以 `top: calc(100% + 6px)` 绝对定位挂在气泡下方,
  从不看视口。九个任务约 310px 高,在 360×640 里选中文档下半部分的文字时,列表底部
  落到 888px、超出视口 248px,「自定义指令」在内的后几项直接够不到——而气泡是
  `position: fixed`,滚页面也救不回来。现在下方放不下就朝上展开。

- fcc37f1: 代码块语言选择开箱可用，语言目录改为按需加载。

  - `@ultra-editor/vue` 此前从不注册任何 lowlight 语言：代码块语言下拉只有「纯文本」，且**完全没有语法高亮**。现在不传 `lowlight` 时会在挂载后把 lowlight 的 common 语言集作为独立异步 chunk 拉进来（gzip ~43 KB，不进主包），并重绘已经画在屏幕上的代码块。传 `lowlight` 则完全以宿主为准，不发起任何加载。
  - 新增 `loadCommonLanguages(lowlight)` 与 `refreshCodeHighlighting(editor)` 两个导出，自己组装扩展的宿主可以复用同一套按需加载逻辑。
  - 语言列表改为打开菜单时才构建：此前每个代码块在 node view 创建时就生成 38 个按钮，长文档全额付费；且构造之后注册的语言永远进不了列表。

- d629702: 修复裁切框在图片旋转或翻转后往错误方向拖动。

  裁切框排布在**被预览 `transform` 旋转的容器内部**,所以它的 `left` / `top` 走的是图片自身的坐标轴,而鼠标走的是屏幕坐标轴。此前拖拽把屏幕增量直接当图片增量用,两个坐标系差了一个变换:图片旋转 90° 后向右拖,框会沿着画面往下走;翻转后方向则是镜像的。旋转之后再调裁切框是这个对话框里最自然的操作,等于该场景下功能不可用。

  指针增量现在先变换回图片坐标系再套用。角度只可能是直角,所以用一张查表而不是三角函数 —— 结果精确,不会出现 `Math.cos(Math.PI / 2)` 那样的 6.1e-17。手柄不需要重新映射:每个手柄跟着框一起旋转,增量修正后它自然跟着指针走。

- d929232: 修复对话框打开时焦点落在关闭按钮上，导致链接等输入流程键盘不可用

  `UeDialog` 开场把焦点交给 `focusables()[0]`,而关闭按钮在 `<header>` 里、DOM 顺序上永远排在插槽内容前面,于是每个对话框都以焦点停在自己的关闭控件上打开。实际后果不是"少一次点击":点「链接」→ 打字,字全被按钮吞掉,输入框始终是空的;再按回车,激活的是关闭按钮,对话框直接关掉,链接一个都没插进去。整条键盘路径是断的。

  `UePrompt` 本来就在 `nextTick` 里 focus + select 自己的输入框,但子组件 `UeDialog` 的 watcher 注册在父组件之后、回调也就跑在后面,把焦点又抢了回去。现在 `UeDialog` 优先聚焦 `.ue-dialog__body` 内的第一个可聚焦元素,body 里没有可聚焦元素时才退回关闭按钮、再退回面板本身——两边不再互相打架,链接、图片地址、AI 自定义指令三个提示框一起恢复。

  原有的 `selectionStart` / `selectionEnd` 断言证明不了这件事:`select()` 不管有没有焦点都会设选区,所以那条测试在缺陷存在时照样通过。新增的断言直接看 `document.activeElement`。

- 45514b2: 修复斜杠命令面板在视口下方被截断，AI 分组点不到

  面板位置原先按两个写死的尺寸估算来夹:`Math.min(rect.left, innerWidth - 280)` 和 `Math.min(rect.bottom + 6, innerHeight - 320)`。但面板高度是随内容变的——接了 AI Provider 之后是 12 个条目加 3 个分组标题,实测 478px,那个 320 的估值根本夹不住。861px 高的窗口里在文档下半部分敲 `/`,面板底部落在 945px,**超出视口 84px**,「续写」「AI 写一段」既点不到也滚不到。

  改成面板自己测量后再夹:`useFloating` 里那段夹取逻辑抽成 `clampToViewport(anchor, rect)`,`UeSlashMenu` 渲染后量一次自己的实际尺寸再定位,`UltraEditor` 只负责给光标锚点。因为是实测,输入关键词把列表筛短之后面板还会跟着回到光标附近——写死的常量做不到这件事。

  同一段夹取逻辑此前在 `useFloating` 和 `UltraEditor` 里各有一份且互不一致,现在只剩一份。

- 8cda582: 修复退出 Markdown 源码模式后,滞留的防抖回写把新编辑覆盖掉。

  源码模式下每次输入都会排一个防抖的「把 Markdown 套用回文档」定时器。卸载时会取消它，但**退出源码模式时不会**。于是在防抖窗口内点「退出 Markdown 源码」、再回到编辑器继续写，那个定时器随后触发，用 textarea 里的旧内容覆盖文档 —— 退出之后写的全部丢失。

  窗口长度是 `debounce || 300` 毫秒；宿主把 `debounce` 调大（例如 1000）时窗口同步变长，很容易踩到。退出路径本来就会显式套用一次 textarea 内容，那个待触发的定时器没有任何存在必要，现在退出时一并取消。

- f76519e: 修复文字颜色面板里的清除按钮写着「清除底色」

  工具栏的颜色面板直接借用了表格菜单的文案键 `table.clearColor`,于是「文字颜色」
  面板里那颗按钮写的是「清除底色」——英文更直白,`Text color` 面板里写着
  `Clear background`。两个面板改的根本不是同一件事:一个改文字颜色,一个改单元格
  背景色。

  新增 `toolbar.clearColor`(清除颜色 / Clear color)给文字颜色面板用,表格菜单继续
  用 `table.clearColor`。

- 0a2eb04: 优化输入时的每次事务开销：字数统计不再全文跑正则，气泡菜单不再重复测量。

  `@tiptap/vue-3` 把编辑器 state 包成响应式 ref，**每个事务都会重新发布**——包括纯光标移动。于是状态栏的字数统计每次都重跑一遍：`getText()` 拿到全文后，`replace(/\s/g)` 复制一份文档、`match(/[一-龥]/g)` 生成一个「每个汉字一个字符串」的数组、再 `replace` + `match` 一次。157 KB 文档上实测单次 3.0 ms，方向键移动光标也照付。现在按文档对象缓存（光标移动直接复用上次结果），统计本身也改成按 char code 的单趟扫描，实测 0.43 ms，快 7 倍。空白字符集与单词字符集已对 BMP 全部 65536 个码位逐一比对过，与原正则完全等价——包括扩展区汉字仍不计入这一既有行为。

  气泡菜单同时监听了 `transaction` 和 `selectionUpdate`。Tiptap 对同一次 dispatch 先发前者、紧接着发后者，所以选区一动 `update()` 就跑两遍，每遍两次 `coordsAtPos`——而 `coordsAtPos` 会强制同步布局。只留 `transaction` 即可，它是前者的严格超集。

  Markdown 序列化里代码块的围栏计算把 `node.textContent` 当循环条件用，而它是每次访问都从子节点重建字符串的 getter，一个代码块要重建 2~3 次。改为只读一次。

- Updated dependencies [3d9060e]
- Updated dependencies [8488fc4]
- Updated dependencies [8488fc4]
- Updated dependencies [fcc37f1]
- Updated dependencies [00d1311]
- Updated dependencies [70ba1cf]
- Updated dependencies [4766855]
- Updated dependencies [1dc75ce]
- Updated dependencies [9ad483a]
- Updated dependencies [bf334a4]
- Updated dependencies [23b32c6]
- Updated dependencies [a7331df]
- Updated dependencies [4c38331]
- Updated dependencies [bb15507]
- Updated dependencies [73e5bef]
- Updated dependencies [f76519e]
- Updated dependencies [0a2eb04]
  - @ultra-editor/core@1.2.0

## 1.1.0

### Minor Changes

- 7e90cac: 代码块补齐语言选择与复制，修复表格右键菜单的滚动条与二级色板，并对齐图片的八个缩放锚点。

  **新增**

  - 代码块现在带一条编辑态工具条：左侧语言选择器（列表取自宿主传入的 lowlight 实例），右侧复制按钮。语言写在 CodeBlock 原有的 `language` 属性上，序列化仍是 `<pre><code class="language-x">`，导出的 HTML 与只读渲染不受影响；工具条本身是 node view，不会进入产物。无 `navigator.clipboard`（非安全上下文）时不渲染复制按钮，只读时语言选择器禁用。
  - 工具条由 core 以纯 DOM node view 绘制，React / Svelte 适配器无需自备实现。

  **修复**

  - 表格右键菜单会同时出现横竖两条滚动条：内容高度只比 `max-height` 多出 10px，而 `overflow-y: auto` 会让水平轴一并变成可滚动。菜单不再在水平方向滚动，垂直空间也放宽到不再需要滚动。
  - 「单元格底色」的色板绝对定位在菜单内部，而菜单是滚动容器，二级面板只会被裁切、无法展开。色板改为 Teleport 到 `<body>` 的浮层，从菜单右侧展开；同一个面板也供工具栏的文字颜色使用。
  - 「单元格底色」此前是 `div`，方向键漫游焦点走不到它；现在是真正的菜单项，`→` / `Enter` 展开，`Esc` 收回。
  - 图片的八个缩放锚点中下方三个偏低、左右两个偏离中点：锚点贴着 resize wrapper 的边缘，而行内 `<img>` 会在下方留出基线间隙（200px 的图，wrapper 高 208px）。

  **i18n**

  - 新增 `codeBlock.language` / `codeBlock.plain` / `codeBlock.copy` / `codeBlock.copied`（`zhCN` 与 `en`）。

- b156fa9: 修复流式生成、代码块开关与图片抓取安全，并补齐浮层的键盘可访问性。

  **修复**

  - AI 流式区域在生成结束后遇到外来事务（例如点击移动光标）时会丢掉 `consumedEmptyBlock` 记账，导致 `/write` 的丢弃 / 撤销吞掉用户原本所在的空段落。
  - `features.codeBlock: false` 此前无法真正关闭代码块，只会退化成无语法高亮的普通代码块；现在彻底移除。
  - 选区气泡菜单展开 AI 子菜单后，在别处点击会让气泡残留在屏幕上；现加入外部点击关闭。
  - SSE 解析：当服务端在最后一个 `data:` 之后不带空行就关闭连接时（vLLM / Ollama / 自建代理常见），最后一个 delta 会被丢弃；现在流结束时 flush 补齐。
  - 图片上传在编辑器已销毁后仍向 view dispatch 会抛错；现加入 `isDestroyed` 守卫。
  - `useToasts` 的自动消失定时器与 `UeCropper` 拖拽的 document 监听在卸载时未清理；现随作用域销毁一并清理。

  **安全**

  - 默认图片抓取（裁切 / 旋转所用的 `defaultImageFetcher` 与 `UeCropper`）改用 `credentials: 'same-origin'`，不再对文档内可控的 URL 发送带 Cookie 的跨域请求。需要携带凭据的宿主通过注入 `fetchImage` 显式开启。

  **可访问性**

  - 模态对话框（含图片裁切）加入焦点陷阱、打开时聚焦、关闭时归还焦点，并补上 `aria-labelledby`。
  - 图片 / 表格右键菜单支持 ↑ / ↓ / Home / End 键盘导航，打开时聚焦首项、关闭时归还焦点。
  - AI 面板在生成中 / 完成 / 出错态支持 Esc 关闭。

  **其他**

  - 移除 10 个从未使用的 i18n key（`ai.tone.*`、`toolbar.highlight`、`toolbar.taskList`、`slash.placeholder`、`ai.aborted`、`common.close`）。如果你曾通过 `messages` 覆盖过这些键，请一并删除。
  - 修正 `link.invalid` 文案：此前声称"仅支持 http/https"，实际也允许 mailto / tel 与相对链接。

### Patch Changes

- Updated dependencies [7e90cac]
- Updated dependencies [b156fa9]
  - @ultra-editor/core@1.1.0

## 1.0.0

AI Native 编辑器 SDK 首个正式版本。

- **AI Native**：斜杠命令面板、选区 AI 气泡菜单、文档内流式生成（可中断 / 重试 / 丢弃）、Tab 接受的幽灵文本补全。通过 `AIProvider` 接口注入，不绑定任何厂商；附赠 OpenAI 兼容与 Anthropic 适配器。
- **接受一次 AI 生成 = 一步撤销**：流式写入不进历史栈，接受时才作为一个普通编辑重放，丢弃则不留痕迹。
- **零 UI 依赖**：移除 Element Plus 与 vue-advanced-cropper，自建对话框 / toast / 取色器 / 画布裁切器。
- **上传解耦**：`UploadHandler` 注入，SDK 内不含任何 HTTP 客户端、URL 或鉴权逻辑。
- **`--ue-*` 样式变量体系**：全部带兜底值，覆盖即换肤，内置深浅色主题。编辑态与阅读态共用一份 `content.css`。
- 编辑器能力：图片（旋转 / 裁切 / 8 锚点缩放 / 对齐 / 图注 / 粘贴与拖拽上传）、1-5 栏卡片、可拖拽行高列宽与单元格底色的表格、代码高亮、字数统计、中英文 i18n、只读模式、SSR guard。

### Dependencies

- 依赖 `@ultra-editor/core@1.0.0`
