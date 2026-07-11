import { en, zhCN, type MessageKey, type Messages } from './messages';

export type { MessageKey, Messages };
export { en, zhCN };

export type LocaleName = 'zh-CN' | 'en';

const BUILT_IN: Record<LocaleName, Messages> = {
  'zh-CN': zhCN,
  en
};

export type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

/**
 * Tiny translator — no i18n library, no runtime reactivity. Overrides let a
 * host app rewrite any single string without forking the locale file.
 */
export function createTranslator(
  locale: LocaleName = 'zh-CN',
  overrides: Partial<Messages> = {}
): Translator {
  const messages = { ...(BUILT_IN[locale] ?? zhCN), ...overrides };
  return (key, vars) => {
    const template = messages[key] ?? key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      name in vars ? String(vars[name]) : match
    );
  };
}
