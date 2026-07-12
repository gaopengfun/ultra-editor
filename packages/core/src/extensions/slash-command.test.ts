import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { SuggestionProps } from '@tiptap/suggestion';
import { createUltraKit } from '../kit';
import {
  DEFAULT_SLASH_ITEMS,
  SlashCommand,
  type SlashContext,
  type SlashItem
} from './slash-command';

const names = (extensions: ReturnType<typeof createUltraKit>) => extensions.map((e) => e.name);

const itemFor = (key: string) => {
  const item = DEFAULT_SLASH_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`no slash item named ${key}`);
  return item;
};

function mount(content: string, extensions = createUltraKit()) {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return new Editor({ element, content, extensions });
}

/**
 * Runs an item the way the palette does: the document still holds the `/` and
 * the query the user typed, and `range` covers exactly that text.
 */
function pick(key: string, ai: SlashContext['ai'] = () => {}) {
  const typed = `/${key}`;
  const editor = mount(`<p>${typed}</p>`);
  itemFor(key).run({ editor, range: { from: 1, to: 1 + typed.length }, ai });
  return editor;
}

/**
 * Drives the real Suggestion plugin. The renderer is the only way into `items()`
 * and `command()` — core hands both to the adapter and never calls them itself.
 */
function palette(config: { hasAI?: boolean; onAI?: SlashContext['ai'] } = {}) {
  let latest: SuggestionProps<SlashItem> | null = null;
  const capture = (props: SuggestionProps<SlashItem>) => {
    latest = props;
  };

  const editor = mount(
    '<p></p>',
    createUltraKit({
      ai: {
        slash: {
          render: () => ({ onStart: capture, onUpdate: capture }),
          hasAI: () => config.hasAI ?? false,
          onAI: config.onAI ?? (() => {})
        }
      }
    })
  );

  return {
    editor,
    props: () => {
      if (!latest) throw new Error('the palette never opened');
      return latest;
    },
    keys: () => (latest?.items ?? []).map((item) => item.key),
    async type(text: string) {
      editor.commands.insertContent(text);
      // The plugin resolves `items()` asynchronously before it renders.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
}

describe('slash palette registration', () => {
  it('registers with no AI provider — /table and /h1 do not depend on AI', () => {
    const extensions = createUltraKit({
      ai: { slash: { render: () => ({}) } }
    });
    expect(names(extensions)).toContain('slashCommand');
  });

  it('stays unregistered when no renderer is supplied — core renders no UI itself', () => {
    expect(names(createUltraKit({ ai: {} }))).not.toContain('slashCommand');
    expect(names(createUltraKit())).not.toContain('slashCommand');
  });

  it('registers ghost text even while disabled, so it can be toggled on later', () => {
    const extensions = createUltraKit({ ai: { ghostText: { enabled: false } } });
    expect(names(extensions)).toContain('ghostText');
  });
});

describe('slash command defaults', () => {
  it('labels items by key and hides AI until a host says otherwise', () => {
    const { items, onAI, render, labelOf, hasAI } = SlashCommand.options;

    expect(items).toBe(DEFAULT_SLASH_ITEMS);
    expect(labelOf(itemFor('table'))).toBe('table');
    expect(hasAI()).toBe(false);
    // No adapter, no menu: the default renderer implements nothing.
    expect(render?.()).toEqual({});
    expect(() => onAI('write')).not.toThrow();
  });
});

describe('slash item filtering', () => {
  it('hides AI entries when there is no provider', async () => {
    const ui = palette();
    await ui.type('/');

    const groups = new Set(ui.props().items.map((item) => item.group));
    expect(groups.has('ai')).toBe(false);
    expect(groups.has('basic')).toBe(true);
    expect(groups.has('insert')).toBe(true);
  });

  it('shows AI entries once a provider exists', async () => {
    const ui = palette({ hasAI: true });
    await ui.type('/');

    expect(ui.props().items.some((item) => item.group === 'ai')).toBe(true);
  });

  it('offers the whole pool on a bare slash', async () => {
    const ui = palette({ hasAI: true });
    await ui.type('/');

    expect(ui.keys()).toEqual(DEFAULT_SLASH_ITEMS.map((item) => item.key));
  });

  it('matches an item by its key', async () => {
    const ui = palette();
    await ui.type('/h1');

    expect(ui.keys()).toEqual(['h1']);
  });

  it('matches the translated label even when the key does not match', async () => {
    const ui = palette();
    // `分割线` is the zh-CN label of `hr` and appears in neither its key nor its
    // keywords — this is the whole reason `labelOf` is injected.
    await ui.type('/分割线');

    expect(ui.keys()).toEqual(['hr']);
  });

  it('matches a pinyin keyword that is neither the key nor the label', async () => {
    const table = palette();
    await table.type('/biaoge');
    expect(table.keys()).toEqual(['table']);

    const columns = palette();
    await columns.type('/fenlan');
    expect(columns.keys()).toEqual(['columns']);
  });

  it('returns nothing when the query matches no item', async () => {
    const ui = palette();
    await ui.type('/zzz');

    expect(ui.keys()).toEqual([]);
  });
});

describe('slash command dispatch', () => {
  it('deletes the typed text and inserts the block when an item is picked', async () => {
    const ui = palette();
    await ui.type('/biaoge');

    const props = ui.props();
    props.command(props.items[0]);

    expect(ui.editor.getText()).not.toContain('/biaoge');
    expect(ui.editor.getHTML()).toContain('<table');
  });

  it('hands an AI item over to the host hook it was configured with', async () => {
    const onAI = vi.fn();
    const ui = palette({ hasAI: true, onAI });
    await ui.type('/xuxie');

    const props = ui.props();
    expect(props.items.map((item) => item.key)).toEqual(['ai-continue']);
    props.command(props.items[0]);

    expect(onAI).toHaveBeenCalledWith('continue');
    expect(ui.editor.getHTML()).toBe('<p></p>');
  });
});

// `not.toContain` is asserted on getText(), never on getHTML(): a closing tag
// such as `</h1>` contains the very `/h1` the assertion is looking for.
// The trailing `<p></p>` in the expected HTML is StarterKit's trailing node —
// it appears whenever the last block is no longer a paragraph.
describe('slash items', () => {
  it('replaces the typed text with a level 1 heading', () => {
    const editor = pick('h1');
    expect(editor.getText()).not.toContain('/h1');
    expect(editor.getHTML()).toBe('<h1></h1><p></p>');
  });

  it('replaces the typed text with a level 2 heading', () => {
    const editor = pick('h2');
    expect(editor.getText()).not.toContain('/h2');
    expect(editor.getHTML()).toBe('<h2></h2><p></p>');
  });

  it('replaces the typed text with a level 3 heading', () => {
    const editor = pick('h3');
    expect(editor.getText()).not.toContain('/h3');
    expect(editor.getHTML()).toBe('<h3></h3><p></p>');
  });

  it('replaces the typed text with a bullet list', () => {
    const editor = pick('bulletList');
    expect(editor.getText()).not.toContain('/bulletList');
    expect(editor.getHTML()).toBe('<ul><li><p></p></li></ul><p></p>');
  });

  it('replaces the typed text with an ordered list', () => {
    const editor = pick('orderedList');
    expect(editor.getText()).not.toContain('/orderedList');
    expect(editor.getHTML()).toBe('<ol><li><p></p></li></ol><p></p>');
  });

  it('replaces the typed text with a blockquote', () => {
    const editor = pick('blockquote');
    expect(editor.getText()).not.toContain('/blockquote');
    expect(editor.getHTML()).toBe('<blockquote><p></p></blockquote><p></p>');
  });

  it('replaces the typed text with a code block', () => {
    const editor = pick('codeBlock');
    expect(editor.getText()).not.toContain('/codeBlock');
    expect(editor.getHTML()).toBe('<pre><code></code></pre><p></p>');
  });

  it('deletes the typed slash text before inserting the table', () => {
    const editor = pick('table');
    const html = editor.getHTML();

    expect(editor.getText()).not.toContain('/table');
    expect(html.match(/<tr/g)?.length).toBe(3);
    expect(html.match(/<th/g)?.length).toBe(3);
    expect(html.match(/<td/g)?.length).toBe(6);
  });

  it('deletes the typed slash text before inserting a two-column block', () => {
    const editor = pick('columns');
    const html = editor.getHTML();

    expect(editor.getText()).not.toContain('/columns');
    expect(html).toContain('data-cols="2"');
    expect(html.match(/ue-column"/g)?.length).toBe(2);
  });

  it('deletes the typed slash text before inserting a horizontal rule', () => {
    const editor = pick('hr');
    const html = editor.getHTML();

    expect(editor.getText()).not.toContain('/hr');
    expect(html).toContain('<hr>');
  });

  it('clears the typed text and hands continuation to the host AI callback', () => {
    const ai = vi.fn();
    const editor = pick('ai-continue', ai);

    expect(editor.getHTML()).toBe('<p></p>');
    expect(ai).toHaveBeenCalledWith('continue');
  });

  it('clears the typed text and hands a fresh write to the host AI callback', () => {
    const ai = vi.fn();
    const editor = pick('ai-write', ai);

    expect(editor.getHTML()).toBe('<p></p>');
    expect(ai).toHaveBeenCalledWith('write');
  });
});
