import {
  CodeBlockLowlight,
  type CodeBlockLowlightOptions
} from '@tiptap/extension-code-block-lowlight';
import { isBrowser } from '../utils/env';
import { createTranslator, type LocaleName, type Messages, type Translator } from '../i18n';
import { ULTRA_EDITOR_OPTIONS_META } from './runtime-options';

export interface UltraCodeBlockOptions extends CodeBlockLowlightOptions {
  locale: LocaleName;
  messages: Partial<Messages>;
  translator?: () => Translator;
}

const ICON = {
  copy: '<svg class="ue-ico ue-codeblock__ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  copied:
    '<svg class="ue-ico ue-codeblock__ico" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
  check:
    '<svg class="ue-menu__check" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'
};

/**
 * Display names for lowlight's `common` set. Anything a host registers beyond it
 * falls back to the raw highlight.js id, which is the honest thing to show — a
 * guessed label would be worse than `nginx`.
 */
const LANGUAGE_LABELS: Record<string, string> = {
  arduino: 'Arduino',
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  diff: 'Diff',
  go: 'Go',
  graphql: 'GraphQL',
  ini: 'INI / TOML',
  java: 'Java',
  javascript: 'JavaScript',
  json: 'JSON',
  kotlin: 'Kotlin',
  less: 'Less',
  lua: 'Lua',
  makefile: 'Makefile',
  markdown: 'Markdown',
  objectivec: 'Objective-C',
  perl: 'Perl',
  php: 'PHP',
  python: 'Python',
  r: 'R',
  ruby: 'Ruby',
  rust: 'Rust',
  scss: 'SCSS',
  shell: 'Shell',
  sql: 'SQL',
  swift: 'Swift',
  typescript: 'TypeScript',
  vbnet: 'VB.NET',
  wasm: 'WebAssembly',
  xml: 'HTML / XML',
  yaml: 'YAML'
};

/** Variants of a language that only add noise to a picker. */
const HIDDEN_LANGUAGES = new Set(['plaintext', 'php-template', 'python-repl']);

const labelOf = (id: string) => LANGUAGE_LABELS[id] ?? id;

/**
 * Code block with a language picker and a copy button.
 *
 * The chrome is a node view, so it exists only while editing: `renderHTML` still
 * emits a bare `<pre><code class="language-…">`, which is what read-only pages
 * style with content.css. The language is not editor-only state — it rides on
 * CodeBlock's existing `language` attribute and survives the round trip.
 */
export const UltraCodeBlock = CodeBlockLowlight.extend<UltraCodeBlockOptions>({
  addOptions() {
    // `parent` is optional on the type but always present on an extended node —
    // without the cast every inherited option would widen to optional.
    return {
      ...(this.parent?.() as CodeBlockLowlightOptions),
      locale: 'zh-CN' as LocaleName,
      messages: {},
      translator: undefined
    };
  },

  addNodeView() {
    if (!isBrowser()) return null;

    const fallback: Translator = createTranslator(this.options.locale, this.options.messages);
    const t = () => this.options.translator?.() ?? fallback;
    const prefix = this.options.languageClassPrefix;
    const lowlight = this.options.lowlight as { listLanguages: () => string[] };
    const languages = lowlight
      .listLanguages()
      .filter((id) => !HIDDEN_LANGUAGES.has(id))
      .sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

    return ({ editor, node, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'ue-codeblock';

      const bar = document.createElement('div');
      bar.className = 'ue-codeblock__bar';
      bar.setAttribute('contenteditable', 'false');

      const pre = document.createElement('pre');
      const contentDOM = document.createElement('code');
      pre.appendChild(contentDOM);

      // The closed-over node and position go stale as soon as anything above this
      // block changes — resolve both on every action instead.
      // Tiptap always hands a node view a `getPos` function, and a live position
      // always resolves back to this node — the two fallbacks below only cover a
      // torn-down view, which already leaves through the `pos == null` arm.
      const current = () => {
        /* v8 ignore next */
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos == null) return null;
        const found = editor.state.doc.nodeAt(pos);
        /* v8 ignore next */
        return found && found.type.name === node.type.name ? { pos, node: found } : null;
      };

      /* Language picker ---------------------------------------------------- */

      let language: string | null = (node.attrs.language as string | null) ?? null;

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'ue-codeblock__lang';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');
      trigger.title = t()('codeBlock.language');

      // A native <select> renders an OS popup: it takes the control's own colour
      // into its options, ignores the editor's surface, and drops a 35-row list
      // over the page. This is the same menu the rest of the editor uses.
      const list = document.createElement('div');
      list.className = 'ue-menu ue-codeblock__langs';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', t()('codeBlock.language'));

      const options: Array<{ id: string | null; item: HTMLButtonElement }> = [];

      const addOption = (id: string | null, label: string) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'ue-menu__item';
        item.setAttribute('role', 'option');
        const text = document.createElement('span');
        text.className = 'ue-menu__label';
        text.textContent = label;
        item.appendChild(text);
        item.addEventListener('mousedown', (event) => event.preventDefault());
        item.addEventListener('click', () => {
          setLanguage(id);
          closeList();
        });
        list.appendChild(item);
        options.push({ id, item });
      };

      addOption(null, t()('codeBlock.plain'));
      languages.forEach((id) => addOption(id, labelOf(id)));

      const syncOptions = () => {
        options.forEach(({ id, item }) => {
          const active = id === language;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
          item.querySelector('.ue-menu__check')?.remove();
          if (active) item.insertAdjacentHTML('beforeend', ICON.check);
        });
      };

      let open = false;

      const place = () => {
        const anchor = trigger.getBoundingClientRect();
        const gap = 6;
        const height = list.offsetHeight;
        const width = list.offsetWidth;
        // Flip above the bar when the block sits near the bottom of the window.
        const below = anchor.bottom + gap;
        const top = below + height > window.innerHeight - gap ? anchor.top - gap - height : below;
        list.style.top = `${Math.max(gap, top)}px`;
        list.style.left = `${Math.max(gap, Math.min(anchor.left, window.innerWidth - width - gap))}px`;
      };

      const onOutside = (event: MouseEvent) => {
        if (!list.contains(event.target as Node) && !trigger.contains(event.target as Node)) {
          closeList();
        }
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closeList();
        trigger.focus();
      };
      // The editor scrolls under a menu pinned to the viewport, so close rather
      // than let the list drift away from the block it belongs to. The list's own
      // scrolling is not that: it fires here too, and closing on it would shut the
      // menu the moment a wheel touched it — or the moment it scrolled the active
      // language into view on open.
      const onScroll = (event: Event) => {
        if (event.target === list) return;
        closeList();
      };

      function openList() {
        // The trigger is the only caller and it already picks between open and
        // close, so this never sees an open list.
        /* v8 ignore next */
        if (open) return;
        open = true;
        syncOptions();
        document.body.appendChild(list);
        place();
        trigger.setAttribute('aria-expanded', 'true');
        const active = options.find((option) => option.id === language)?.item ?? options[0]?.item;
        // Optional call, not optional element: jsdom has no scrollIntoView.
        active?.scrollIntoView?.({ block: 'nearest' });
        active?.focus();
        window.addEventListener('mousedown', onOutside, true);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);
      }

      function closeList() {
        if (!open) return;
        open = false;
        list.remove();
        trigger.setAttribute('aria-expanded', 'false');
        window.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
      }

      // Roving focus, so the list is operable without a mouse.
      list.addEventListener('keydown', (event) => {
        const items = options.map((option) => option.item);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          items[(index + 1) % items.length]?.focus();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          items[(index - 1 + items.length) % items.length]?.focus();
        }
      });

      function setLanguage(next: string | null) {
        const target = current();
        if (!target) return;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(target.pos, undefined, {
            ...target.node.attrs,
            language: next
          })
        );
        editor.view.focus();
      }

      trigger.addEventListener('mousedown', (event) => event.preventDefault());
      trigger.addEventListener('click', () => (open ? closeList() : openList()));

      const syncLanguage = (next: string | null) => {
        language = next;
        trigger.textContent = next ? labelOf(next) : t()('codeBlock.plain');
        contentDOM.className = next ? `${prefix}${next}` : '';
        if (open) syncOptions();
      };

      /* Copy --------------------------------------------------------------- */

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'ue-codeblock__copy';

      const copyLabel = document.createElement('span');
      const renderCopy = (copied: boolean) => {
        copy.innerHTML = copied ? ICON.copied : ICON.copy;
        copyLabel.textContent = copied ? t()('codeBlock.copied') : t()('codeBlock.copy');
        copy.appendChild(copyLabel);
        copy.classList.toggle('is-copied', copied);
      };
      renderCopy(false);

      // No clipboard means no button. A copy control that silently does nothing
      // on an insecure origin is worse than one that was never offered.
      if (!navigator.clipboard) copy.hidden = true;

      let copiedTimer: ReturnType<typeof setTimeout> | undefined;
      copy.addEventListener('mousedown', (event) => event.preventDefault());
      copy.addEventListener('click', async () => {
        const target = current();
        if (!target) return;
        try {
          await navigator.clipboard.writeText(target.node.textContent);
        } catch {
          return; // Denied permission — say nothing rather than claim a copy that never happened.
        }
        renderCopy(true);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => renderCopy(false), 1500);
      });

      /* Assembly ----------------------------------------------------------- */

      bar.append(trigger, copy);
      dom.append(bar, pre);

      // `setEditable` emits an update, which is how the picker learns it should
      // stop being operable in a read-only editor.
      const syncEditable = () => {
        trigger.disabled = !editor.isEditable;
        if (trigger.disabled) closeList();
      };
      editor.on('update', syncEditable);

      const syncRuntimeOptions = ({
        transaction
      }: {
        transaction: import('@tiptap/pm/state').Transaction;
      }) => {
        if (!transaction.getMeta(ULTRA_EDITOR_OPTIONS_META)) return;
        trigger.title = t()('codeBlock.language');
        list.setAttribute('aria-label', t()('codeBlock.language'));
        const plain = options[0]?.item.querySelector<HTMLElement>('.ue-menu__label');
        if (plain) plain.textContent = t()('codeBlock.plain');
        syncLanguage(language);
        renderCopy(copy.classList.contains('is-copied'));
      };
      editor.on('transaction', syncRuntimeOptions);

      syncLanguage(language);
      syncEditable();

      return {
        dom,
        contentDOM,
        update: (updatedNode) => {
          // ProseMirror only calls a node view's `update` when the incoming node has
          // the same type (CustomNodeViewDesc gates on `this.node.type == node.type`
          // unless the spec opts into `multiType`, which this one does not).
          /* v8 ignore next */
          if (updatedNode.type !== node.type) return false;
          syncLanguage((updatedNode.attrs.language as string | null) ?? null);
          return true;
        },
        stopEvent: (event) =>
          bar.contains(event.target as Node) || list.contains(event.target as Node),
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') return false;
          return !contentDOM.contains(mutation.target as Node);
        },
        destroy: () => {
          closeList();
          clearTimeout(copiedTimer);
          editor.off('update', syncEditable);
          editor.off('transaction', syncRuntimeOptions);
        }
      };
    };
  }
});
