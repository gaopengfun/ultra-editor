import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Editor } from '@tiptap/vue-3';
import { createTranslator, createUltraKit, MAX_COLUMNS } from '@ultra-editor/core';
import UeToolbar from './UeToolbar.vue';

/**
 * jsdom ships no layout engine, so `Range` has no `getClientRects` at all. Tiptap's
 * `focus()` scrolls the selection into view one animation frame later, which walks
 * straight into ProseMirror's `coordsAtPos` — so without this shim every toolbar
 * click (they all `.chain().focus()`) throws inside a requestAnimationFrame.
 */
const EMPTY_RECT = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({})
} as DOMRect;

Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => EMPTY_RECT;

/**
 * `@tiptap/vue-3` feeds editor state into a ref that only triggers two animation
 * frames after a transaction, so the active states a command produces are not in
 * the DOM until then.
 */
async function flush() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await nextTick();
}

let editor: Editor;
let wrapper: VueWrapper;

function mountToolbar(
  props: { hasAI?: boolean; color?: string | null; locale?: 'zh-CN' | 'en' } = {}
) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, content: '<p>正文</p>', extensions: createUltraKit() });

  wrapper = mount(UeToolbar, {
    attachTo: document.body,
    props: {
      editor,
      color: props.color ?? null,
      hasAI: props.hasAI ?? false,
      t: createTranslator(props.locale ?? 'zh-CN')
    }
  });
  return wrapper;
}

const button = (title: string) => wrapper.get(`button[title="${title}"]`);
/** `get` throws when the button is missing, so asking whether it is there needs `find`. */
const findButton = (title: string) => wrapper.find(`button[title="${title}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
  mountToolbar();
});

afterEach(() => {
  wrapper.unmount();
  editor.destroy();
});

describe('headings', () => {
  it.each([1, 2, 3] as const)(
    'turns the block into an H%i and lights the button',
    async (level) => {
      expect(button(`标题 ${level}`).classes()).not.toContain('is-active');

      await button(`标题 ${level}`).trigger('click');
      await flush();

      expect(editor.getHTML()).toContain(`<h${level}>正文</h${level}>`);
      expect(editor.getHTML()).not.toContain('<p>正文</p>');
      expect(button(`标题 ${level}`).classes()).toContain('is-active');
    }
  );
});

describe('marks', () => {
  const MARKS = [
    { title: '加粗', tag: 'strong' },
    { title: '斜体', tag: 'em' },
    { title: '下划线', tag: 'u' },
    { title: '删除线', tag: 's' },
    { title: '行内代码', tag: 'code' }
  ];

  it.each(MARKS)('wraps the selection in $tag and lights $title', async ({ title, tag }) => {
    editor.commands.setTextSelection({ from: 1, to: 3 });
    expect(button(title).classes()).not.toContain('is-active');

    await button(title).trigger('click');
    await flush();

    expect(editor.getHTML()).toBe(`<p><${tag}>正文</${tag}></p>`);
    expect(button(title).classes()).toContain('is-active');
  });
});

describe('blocks', () => {
  const BLOCKS = [
    { title: '无序列表', tag: 'ul' },
    { title: '有序列表', tag: 'ol' },
    { title: '引用', tag: 'blockquote' },
    { title: '代码块', tag: 'pre' }
  ];

  it.each(BLOCKS)('turns the block into a $tag and lights $title', async ({ title, tag }) => {
    expect(button(title).classes()).not.toContain('is-active');

    await button(title).trigger('click');
    await flush();

    expect(editor.getHTML()).toContain(`<${tag}>`);
    expect(button(title).classes()).toContain('is-active');
  });
});

describe('colour', () => {
  it('emits the swatch the author picks out of the colour panel', async () => {
    await wrapper.get('.ue-color-trigger').trigger('click');

    // The panel is teleported to <body>, so it is not inside wrapper.element.
    const swatch = document.body.querySelector<HTMLButtonElement>(
      '.ue-swatch[aria-label="#dc2626"]'
    );
    swatch?.click();
    await nextTick();

    expect(wrapper.emitted('color')).toEqual([['#dc2626']]);
  });

  it('emits a clear request rather than a colour when the palette is cleared', async () => {
    await wrapper.get('.ue-color-trigger').trigger('click');

    const clear = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('.ue-color-actions .ue-btn')
    ).find((element) => element.textContent?.trim() === '清除底色');
    clear?.click();
    await nextTick();

    expect(wrapper.emitted('clear-color')).toHaveLength(1);
    expect(wrapper.emitted('color')).toBeUndefined();
  });

  it('shows the current colour on the trigger chip', () => {
    wrapper.unmount();
    editor.destroy();
    mountToolbar({ color: '#16a34a' });

    expect(wrapper.get('.ue-color-trigger__chip').attributes('style')).toContain(
      'background: rgb(22, 163, 74)'
    );
  });
});

describe('link and image', () => {
  it('asks the host to open the link dialog and lights up inside a link', async () => {
    await button('链接').trigger('click');
    expect(wrapper.emitted('link')).toHaveLength(1);
    expect(button('链接').classes()).not.toContain('is-active');

    editor.commands.setContent('<p><a href="https://example.com">站点</a></p>');
    editor.commands.setTextSelection({ from: 1, to: 3 });
    await flush();

    expect(button('链接').classes()).toContain('is-active');
  });

  it('asks the host to open the file picker', async () => {
    await button('图片（插入后右击可旋转 / 裁切 / 对齐 / 加图注）').trigger('click');
    expect(wrapper.emitted('image')).toHaveLength(1);
  });
});

describe('columns', () => {
  /** Inside the first card's paragraph — `insertColumns` leaves the caret where it was. */
  function firstColumnPos() {
    let pos = 0;
    editor.state.doc.descendants((node, at) => {
      if (!pos && node.type.name === 'column') pos = at + 2;
    });
    return pos;
  }

  it('inserts the number of columns the grid offers', async () => {
    await button('分栏').trigger('click');
    expect(wrapper.findAll('.ue-grid__cell')).toHaveLength(MAX_COLUMNS);

    await wrapper.get('[aria-label="插入 3 栏"]').trigger('click');
    await flush();

    const html = editor.getHTML();
    expect(html).toContain('data-cols="3"');
    expect(html.match(/ue-column"/g)).toHaveLength(3);
  });

  it('disables itself once the caret sits inside a column, so blocks cannot nest', async () => {
    expect(button('分栏').attributes('disabled')).toBeUndefined();

    await button('分栏').trigger('click');
    await wrapper.get('[aria-label="插入 2 栏"]').trigger('click');
    editor.commands.setTextSelection(firstColumnPos());
    await flush();

    expect(button('分栏').attributes('disabled')).toBeDefined();
  });
});

describe('table', () => {
  it('inserts the picked grid with a header row, and refuses to nest', async () => {
    await button('表格').trigger('click');
    await wrapper.get('[aria-label="插入 3 × 4 表格"]').trigger('click');
    await flush();

    const html = editor.getHTML();
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html.match(/<th/g)).toHaveLength(4);
    expect(button('表格').attributes('disabled')).toBeDefined();
  });
});

describe('horizontal rule and clear', () => {
  it('drops a horizontal rule into the document', async () => {
    await button('分割线').trigger('click');
    await flush();

    expect(editor.getHTML()).toContain('<hr>');
  });

  it('strips every mark and node back to plain paragraphs', async () => {
    editor.commands.setContent('<h2><strong>标题</strong></h2>');
    editor.commands.selectAll();

    await button('清除格式').trigger('click');
    await flush();

    const html = editor.getHTML();
    expect(html).toContain('<p>标题</p>');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<h2>');
  });
});

describe('history', () => {
  it('disables undo until there is an edit, then takes the document back', async () => {
    expect(button('撤销').attributes('disabled')).toBeDefined();

    editor.commands.insertContent('新增');
    await flush();
    expect(button('撤销').attributes('disabled')).toBeUndefined();

    await button('撤销').trigger('click');
    await flush();

    expect(editor.getHTML()).toBe('<p>正文</p>');
  });

  it('disables redo until an undo has happened, then reapplies the edit', async () => {
    expect(button('重做').attributes('disabled')).toBeDefined();

    editor.commands.insertContent('新增');
    editor.commands.undo();
    await flush();
    expect(button('重做').attributes('disabled')).toBeUndefined();

    await button('重做').trigger('click');
    await flush();

    expect(editor.getHTML()).toContain('新增');
  });
});

describe('AI', () => {
  it('hides the AI button when no provider is configured', () => {
    expect(wrapper.find('.ue-tb-btn--ai').exists()).toBe(false);
  });

  it('asks the host to run a generation when a provider is configured', async () => {
    wrapper.unmount();
    editor.destroy();
    mountToolbar({ hasAI: true });

    const ai = wrapper.get('.ue-tb-btn--ai');
    expect(ai.text()).toBe('AI 助手');

    await ai.trigger('click');
    expect(wrapper.emitted('ai')).toHaveLength(1);
  });
});

describe('locale', () => {
  it('labels every control through the translator it is given', () => {
    wrapper.unmount();
    editor.destroy();
    mountToolbar({ locale: 'en', hasAI: true });

    expect(findButton('Bold').exists()).toBe(true);
    expect(findButton('Undo').exists()).toBe(true);
    expect(button('Heading 1').text()).toBe('H1');
    expect(wrapper.get('.ue-tb-btn--ai').text()).toBe('AI assistant');
    expect(wrapper.get('.ue-color-trigger').attributes('title')).toBe('Text color');
  });
});
