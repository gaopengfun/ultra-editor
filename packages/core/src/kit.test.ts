import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, type Extensions } from '@tiptap/core';
import { createLowlight } from 'lowlight';
import { createUltraKit, type UltraKitOptions } from './kit';
import {
  DEFAULT_SLASH_ITEMS,
  type SlashCommandOptions,
  type SlashItem
} from './extensions/slash-command';
import type { AIProvider } from './ai/types';

function makeEditor(content = '', options?: UltraKitOptions) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions: createUltraKit(options) });
}

const names = (options?: UltraKitOptions) =>
  createUltraKit(options).map((extension) => extension.name);

function optionsOf<T>(extensions: Extensions, name: string): T {
  const found = extensions.find((extension) => extension.name === name);
  if (!found) throw new Error(`extension not registered: ${name}`);
  return found.options as T;
}

const slashOptionsOf = (options: UltraKitOptions) =>
  optionsOf<SlashCommandOptions>(createUltraKit(options), 'slashCommand');

function slashItem(key: string): SlashItem {
  const item = DEFAULT_SLASH_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`no such slash item: ${key}`);
  return item;
}

const stubProvider: AIProvider = {
  stream: async function* () {
    yield 'ok';
  }
};

let editor: Editor;

beforeEach(() => {
  document.body.innerHTML = '';
  editor = makeEditor();
});

describe('image', () => {
  it('round-trips a captioned, aligned figure', () => {
    editor.commands.setContent(
      '<figure class="ue-figure" data-align="center"><img src="/a.png"><figcaption>说明</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('<figure');
    expect(html).toContain('data-align="center"');
    expect(html).toContain('<figcaption>说明</figcaption>');
    expect(html).toContain('src="/a.png"');
  });

  it('still parses documents written with the old tiptap-figure class', () => {
    editor.commands.setContent(
      '<figure class="tiptap-figure" data-align="right"><img src="/legacy.png"><figcaption>旧文章</figcaption></figure>'
    );
    const html = editor.getHTML();

    expect(html).toContain('data-align="right"');
    expect(html).toContain('/legacy.png');
    expect(html).toContain('旧文章');
  });

  it('refuses to serialise a scripting-scheme image source', () => {
    editor.commands.setContent('<img src="javascript:alert(1)">');
    expect(editor.getHTML()).not.toContain('javascript:');
  });

  it('round-trips data URLs produced by the default image upload handler', () => {
    const source = 'data:image/png;base64,iVBORw0KGgo=';
    editor.commands.setContent(`<img src="${source}" alt="inline.png">`);
    const saved = editor.getHTML();
    const reloaded = makeEditor(saved);

    expect(saved).toContain(source);
    expect(reloaded.getHTML()).toContain(source);
    expect(reloaded.getHTML()).toContain('alt="inline.png"');

    reloaded.destroy();
  });
});

describe('columns', () => {
  it('inserts a column block with the requested number of cards', () => {
    editor.commands.insertColumns(3);
    const html = editor.getHTML();

    expect(html).toContain('class="ue-columns"');
    expect(html).toContain('data-cols="3"');
    expect(html.match(/ue-column"/g)?.length).toBe(3);
  });

  it('clamps the count to the supported 1–5 range', () => {
    editor.commands.insertColumns(9);
    expect(editor.getHTML()).toContain('data-cols="5"');
  });

  it('refuses to nest a column block inside another', () => {
    editor.commands.insertColumns(2);
    // Put the cursor inside the first card, then try again.
    editor.commands.setTextSelection(3);
    expect(editor.commands.insertColumns(2)).toBe(false);
  });

  it('parses legacy tiptap-column markup', () => {
    editor.commands.setContent(
      '<div class="tiptap-columns"><div class="tiptap-column"><p>a</p></div><div class="tiptap-column"><p>b</p></div></div>'
    );
    expect(editor.getHTML()).toContain('data-cols="2"');
  });
});

describe('code block', () => {
  it('keeps the chosen language in the serialised HTML', () => {
    editor.commands.setContent('<pre><code class="language-typescript">const a = 1</code></pre>');
    const html = editor.getHTML();

    // On the `<pre>` as well as the `<code>`: the class is what a sanitiser
    // strips, the data attribute is what survives to be read back.
    expect(html).toContain('<pre data-language="typescript"><code class="language-typescript">');
    expect(html).toContain('const a = 1');
  });

  it('holds more than one line', () => {
    editor.commands.setContent('<pre><code>a\nb</code></pre>');
    expect(editor.getHTML()).toContain('a\nb');
  });

  it('leaves the editing chrome out of the serialised HTML', () => {
    editor.commands.setContent('<pre><code>x</code></pre>');
    const html = editor.getHTML();

    // The language picker and copy button are a node view: they exist while
    // writing and must never reach a published article.
    expect(html).not.toContain('ue-codeblock');
    expect(html).not.toContain('<select');
    expect(html).toContain('<pre><code>x</code></pre>');
  });

  it('draws the picker and the copy button on the block while editing', () => {
    editor.commands.setContent('<pre><code class="language-css">a{}</code></pre>');
    const bar = editor.view.dom.querySelector('.ue-codeblock__bar');

    expect(bar).not.toBeNull();
    expect(bar?.querySelector('.ue-codeblock__lang')?.textContent).toBe('CSS');
  });

  it('picks a language from its own menu rather than a native select', () => {
    editor.commands.setContent('<pre><code>a</code></pre>');
    const trigger = editor.view.dom.querySelector<HTMLButtonElement>('.ue-codeblock__lang');
    trigger?.click();

    const list = document.querySelector('.ue-codeblock__langs');
    expect(list).not.toBeNull();

    const rust = Array.from(list?.querySelectorAll<HTMLButtonElement>('.ue-menu__item') ?? []).find(
      (item) => item.textContent === 'Rust'
    );
    rust?.click();

    expect(editor.getHTML()).toContain('class="language-rust"');
    // The list is teleported to <body>; picking has to take it back down again.
    expect(document.querySelector('.ue-codeblock__langs')).toBeNull();
  });
});

describe('table', () => {
  it('serialises a cell background with a readable text colour', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setCellAttribute('backgroundColor', '#111111');

    // The DOM normalises the inline style, so hex comes back out as rgb().
    const html = editor.getHTML();
    expect(html).toContain('background-color: rgb(17, 17, 17)');
    // Dark fill → white text, derived rather than stored.
    expect(html).toContain('color: rgb(255, 255, 255)');
  });

  it('derives near-black text for a light fill', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    editor.commands.setCellAttribute('backgroundColor', '#fef08a');

    expect(editor.getHTML()).toContain('color: rgb(31, 41, 55)');
  });

  it('persists a dragged row height as an inline style', () => {
    editor.commands.setContent(
      '<table><tbody><tr style="height: 80px"><td><p>a</p></td></tr></tbody></table>'
    );
    expect(editor.getHTML()).toContain('height: 80px');
  });
});

describe('feature matrix', () => {
  it('turns every feature group on when the host asks for nothing', () => {
    expect(names()).toEqual([
      'starterKit',
      'placeholder',
      'image',
      'imageUpload',
      'columnBlock',
      'column',
      'table',
      'tableRow',
      'tableHeader',
      'tableCell',
      'textStyle',
      'color',
      'codeBlock',
      'markdownPaste',
      'aiStream'
    ]);
  });

  it('drops only the image extensions when image is off', () => {
    const registered = names({ features: { image: false } });

    expect(registered).not.toContain('image');
    expect(registered).not.toContain('imageUpload');
    expect(registered).toEqual(
      expect.arrayContaining(['columnBlock', 'table', 'color', 'codeBlock'])
    );
  });

  it('drops only the column extensions when columns are off', () => {
    const registered = names({ features: { columns: false } });

    expect(registered).not.toContain('columnBlock');
    expect(registered).not.toContain('column');
    expect(registered).toEqual(expect.arrayContaining(['image', 'table', 'color', 'codeBlock']));
  });

  it('drops only the table extensions when tables are off', () => {
    const registered = names({ features: { table: false } });

    expect(registered).not.toContain('table');
    expect(registered).not.toContain('tableRow');
    expect(registered).not.toContain('tableHeader');
    expect(registered).not.toContain('tableCell');
    expect(registered).toEqual(
      expect.arrayContaining(['image', 'columnBlock', 'color', 'codeBlock'])
    );
  });

  it('drops only the colour extensions when colour is off', () => {
    const registered = names({ features: { color: false } });

    expect(registered).not.toContain('textStyle');
    expect(registered).not.toContain('color');
    expect(registered).toEqual(
      expect.arrayContaining(['image', 'columnBlock', 'table', 'codeBlock'])
    );
  });

  it('drops only the code block when code blocks are off', () => {
    const registered = names({ features: { codeBlock: false } });

    expect(registered).not.toContain('codeBlock');
    expect(registered).toEqual(expect.arrayContaining(['image', 'columnBlock', 'table', 'color']));
  });

  it('leaves no code block in the schema at all when code blocks are off', () => {
    const plain = makeEditor('', { features: { codeBlock: false } });

    // StarterKit's own code block is disabled unconditionally: were it left on,
    // `features.codeBlock: false` would silently keep an unstyled code block.
    expect(plain.schema.nodes.codeBlock).toBeUndefined();
    expect(editor.schema.nodes.codeBlock).toBeDefined();

    plain.destroy();
  });

  it('drops only the markdown paste handler when markdown is off', () => {
    const registered = names({ features: { markdown: false } });

    expect(registered).not.toContain('markdownPaste');
    expect(registered).toEqual(
      expect.arrayContaining(['image', 'columnBlock', 'table', 'color', 'codeBlock'])
    );
  });

  it('keeps the AI stream extension even with every feature group off', () => {
    const registered = names({
      features: {
        image: false,
        columns: false,
        table: false,
        color: false,
        codeBlock: false,
        markdown: false
      }
    });

    expect(registered).toEqual(['starterKit', 'placeholder', 'aiStream']);
  });
});

describe('placeholder, locale and messages', () => {
  const placeholderOf = (options: UltraKitOptions) =>
    optionsOf<{ placeholder: string | (() => string) }>(createUltraKit(options), 'placeholder')
      .placeholder;

  it("falls back to the locale's own placeholder string", () => {
    expect(placeholderOf({})).toBe('请输入内容…');
    expect(placeholderOf({ locale: 'en' })).toBe('Start writing…');
  });

  it('prefers an explicit placeholder over the locale default', () => {
    expect(placeholderOf({ locale: 'en', placeholder: '写点什么…' })).toBe('写点什么…');
  });

  it('lets a message override rewrite the placeholder without switching locale', () => {
    expect(placeholderOf({ messages: { 'editor.placeholder': '开始吧…' } })).toBe('开始吧…');
  });

  it('resolves the placeholder from a live translator when one is supplied', () => {
    let prefix = 'first';
    const placeholder = placeholderOf({
      translator: () => (key) => `${prefix}:${key}`
    }) as () => string;

    expect(placeholder()).toBe('first:editor.placeholder');
    prefix = 'second';
    expect(placeholder()).toBe('second:editor.placeholder');
  });

  it('hands the locale and message overrides down to the column and code-block chrome', () => {
    const messages = { 'toolbar.columns': 'Cols' };
    const extensions = createUltraKit({ locale: 'en', messages });

    expect(
      optionsOf<{ locale: string; messages: object }>(extensions, 'columnBlock')
    ).toMatchObject({ locale: 'en', messages });
    expect(optionsOf<{ locale: string; messages: object }>(extensions, 'codeBlock')).toMatchObject({
      locale: 'en',
      messages
    });
  });

  it('defaults that chrome to Chinese with no overrides', () => {
    const extensions = createUltraKit();

    expect(
      optionsOf<{ locale: string; messages: object }>(extensions, 'columnBlock')
    ).toMatchObject({ locale: 'zh-CN', messages: {} });
    expect(optionsOf<{ locale: string; messages: object }>(extensions, 'codeBlock')).toMatchObject({
      locale: 'zh-CN',
      messages: {}
    });
  });

  it('accepts a caller-built lowlight instance so a host can trim the language set', () => {
    type WithLowlight = { lowlight: ReturnType<typeof createLowlight> };
    const trimmed = optionsOf<WithLowlight>(
      createUltraKit({ lowlight: createLowlight() }),
      'codeBlock'
    );
    const fallback = optionsOf<WithLowlight>(createUltraKit(), 'codeBlock');

    expect(trimmed.lowlight.listLanguages()).toEqual([]);
    expect(fallback.lowlight.listLanguages()).toContain('typescript');
  });
});

describe('upload plumbing', () => {
  it('wires the host upload seam and error callback into the image upload extension', () => {
    const upload = vi.fn(async () => 'https://cdn.example.com/a.png');
    const onUploadError = vi.fn();
    const extensions = createUltraKit({
      upload: { upload, maxSize: 128, concurrency: 2, accept: ['image/png'] },
      onUploadError
    });

    expect(optionsOf<Record<string, unknown>>(extensions, 'imageUpload')).toMatchObject({
      upload,
      maxSize: 128,
      concurrency: 2,
      accept: ['image/png'],
      onError: onUploadError
    });
  });

  it('falls back to the 5 MB image-only defaults when no upload options are given', () => {
    const options = optionsOf<{ maxSize: number; concurrency: number; accept: string[] }>(
      createUltraKit(),
      'imageUpload'
    );

    expect(options.maxSize).toBe(5 * 1024 * 1024);
    expect(options.concurrency).toBe(3);
    expect(options.accept).toEqual(['image/']);
  });
});

describe('slash palette wiring', () => {
  it('stays out of the extension list when the host disables it explicitly', () => {
    expect(names({ ai: { slash: { render: () => ({}), enabled: false } } })).not.toContain(
      'slashCommand'
    );
    expect(names({ ai: { slash: { render: () => ({}), enabled: true } } })).toContain(
      'slashCommand'
    );
  });

  it('falls back to the built-in catalogue and a no-op AI hook', () => {
    const options = slashOptionsOf({ ai: { slash: { render: () => ({}) } } });

    expect(options.items).toBe(DEFAULT_SLASH_ITEMS);
    expect(() => options.onAI('continue')).not.toThrow();
  });

  it('keeps every host-supplied item, hook and resolver', () => {
    const items = [slashItem('table')];
    const onAI = vi.fn();
    const options = slashOptionsOf({
      ai: {
        slash: {
          render: () => ({}),
          items,
          onAI,
          labelOf: () => 'custom',
          hasAI: () => true
        }
      }
    });
    options.onAI('improve', 'shorter');

    expect(options.items).toBe(items);
    expect(onAI).toHaveBeenCalledWith('improve', 'shorter');
    expect(options.labelOf(slashItem('h1'))).toBe('custom');
    expect(options.hasAI()).toBe(true);
  });

  it('localises item labels through the translator when the host supplies no labelOf', () => {
    expect(slashOptionsOf({ ai: { slash: { render: () => ({}) } } }).labelOf(slashItem('h1'))).toBe(
      '标题 1'
    );
    expect(
      slashOptionsOf({ locale: 'en', ai: { slash: { render: () => ({}) } } }).labelOf(
        slashItem('h1')
      )
    ).toBe('Heading 1');
  });

  it('hides the AI group by default when no provider is configured', () => {
    expect(slashOptionsOf({ ai: { slash: { render: () => ({}) } } }).hasAI()).toBe(false);
  });

  it('shows the AI group once a provider is configured', () => {
    expect(
      slashOptionsOf({ ai: { provider: stubProvider, slash: { render: () => ({}) } } }).hasAI()
    ).toBe(true);
  });

  it('sees a provider swapped in after the kit was built, because it reads the getter', () => {
    let provider: AIProvider | null = null;
    const options = slashOptionsOf({
      ai: { provider: () => provider, slash: { render: () => ({}) } }
    });

    expect(options.hasAI()).toBe(false);

    provider = stubProvider;
    expect(options.hasAI()).toBe(true);
  });
});

describe('ghost text wiring', () => {
  const ghostOptionsOf = (options: UltraKitOptions) =>
    optionsOf<Record<string, unknown>>(createUltraKit(options), 'ghostText');

  it('stays out of the extension list when there is no ai block at all', () => {
    expect(names()).not.toContain('ghostText');
  });

  it('registers with autocomplete off and conservative timings by default', () => {
    expect(ghostOptionsOf({ ai: {} })).toMatchObject({
      provider: null,
      enabled: false,
      delay: 800,
      minChars: 8,
      contextLength: 2000,
      locale: 'zh-CN',
      hint: 'Tab 接受 · Esc 忽略'
    });
  });

  it('passes the host tuning through untouched', () => {
    expect(
      ghostOptionsOf({
        locale: 'en',
        ai: {
          provider: stubProvider,
          ghostText: { enabled: true, delay: 50, minChars: 2, contextLength: 100, hint: 'Tab' }
        }
      })
    ).toMatchObject({
      provider: stubProvider,
      enabled: true,
      delay: 50,
      minChars: 2,
      contextLength: 100,
      locale: 'en',
      hint: 'Tab'
    });
  });

  it('resolves the default hint from a live translator', () => {
    let prefix = 'first';
    const options = ghostOptionsOf({
      translator: () => (key) => `${prefix}:${key}`,
      ai: {}
    });
    const hint = options.hint as () => string;

    expect(hint()).toBe('first:ai.ghostHint');
    prefix = 'second';
    expect(hint()).toBe('second:ai.ghostHint');
  });
});
