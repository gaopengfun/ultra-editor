import { describe, expect, it } from 'vitest';
import { createUltraKit } from '../kit';
import { DEFAULT_SLASH_ITEMS, SlashCommand } from './slash-command';

const names = (extensions: ReturnType<typeof createUltraKit>) => extensions.map((e) => e.name);

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

describe('slash item filtering', () => {
  const itemsFor = (hasAI: boolean) => {
    const configured = SlashCommand.configure({
      items: DEFAULT_SLASH_ITEMS,
      hasAI: () => hasAI,
      labelOf: (item) => item.key,
      onAI: () => {},
      render: () => ({})
    });
    // Mirrors the filter the Suggestion plugin applies to the item pool.
    const pool = configured.options.hasAI()
      ? configured.options.items
      : configured.options.items.filter((item) => item.group !== 'ai');
    return pool;
  };

  it('hides AI entries when there is no provider', () => {
    const groups = new Set(itemsFor(false).map((item) => item.group));
    expect(groups.has('ai')).toBe(false);
    expect(groups.has('basic')).toBe(true);
    expect(groups.has('insert')).toBe(true);
  });

  it('shows AI entries once a provider exists', () => {
    expect(itemsFor(true).some((item) => item.group === 'ai')).toBe(true);
  });
});
