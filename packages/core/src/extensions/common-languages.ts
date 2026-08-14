import { common } from 'lowlight';

/**
 * lowlight's common grammar set, behind its own module.
 *
 * `loadCommonLanguages` reaches this with `import()`, which is what gives a
 * bundler a clean split point: ~300 KB of syntax parsers stay out of the main
 * chunk. Re-exported by name rather than dynamically importing `lowlight`
 * itself, because that package also exports `all` — 190 grammars a named
 * static import lets the bundler drop and a namespace import may not.
 */
export default common;
