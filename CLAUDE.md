# CLAUDE.md

An AI Native rich text editor SDK built on Tiptap 3 / ProseMirror, published as two npm packages.
This file covers the invariants that aren't obvious from any single file. Read `README.md` for what
the product does and `docs/` for the public API.

## Layout

| Path              | What it is                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | `@ultra-editor/core` — framework-agnostic: Tiptap extensions, the AI engine, **all** the CSS. No Vue, no React.     |
| `packages/vue`    | `@ultra-editor/vue` — Vue 3 chrome: `UltraEditor.vue`, floating menus, composables. Zero third-party UI deps.       |
| `playground`      | Local dev app. Ships a mock `AIProvider` so the whole AI surface runs with no key and no network.                   |
| `docs/`           | Plain markdown, **not** a workspace package. There is no docs site and no docs script — read the files directly.     |

pnpm workspace, Node ≥ 20.19, pnpm 11. `@ultra-editor/core` and `@ultra-editor/vue` are
[changesets `fixed`](.changeset/config.json) — they always version and publish together.

## Commands

```bash
pnpm dev       # playground on vite
pnpm verify    # lint + type-check + test + build — run this before calling anything done
pnpm test      # vitest run (jsdom); pnpm test:watch to iterate
pnpm build     # core then vue; vue depends on core's dist
```

`vitest.config.ts` aliases both packages to their `src/`, so tests never need a build. Tests are
colocated (`src/**/*.test.ts`).

## Invariants

These are load-bearing. Breaking one usually still compiles.

**core imports nothing framework-specific.** A React or Svelte adapter must be able to call
`createUltraKit()` and supply only its own chrome. Anything core can't render itself is injected as a
callback — the slash palette takes a `render` function, an `onAI` hook, and a `labelOf` translator;
core never mounts a menu. Put Vue code in `packages/vue`.

**Vue components carry no `<style>` block.** Every rule lives in `packages/core/styles/*.css`, class
prefix `ue-`, and consumers import one stylesheet. `content.css` is shared by the editor and by
read-only article pages (`.ue-content`) on purpose — one source of truth, no drift.

**Design tokens sit on `:root`, not `.ultra-editor`.** Menus, dialogs and toasts Teleport to
`<body>`, outside the editor element; scoping the tokens would leave every floating surface
unstyled. Same reason `data-theme` must go on `<html>`.

**AI writes bypass the history stack.** `AIStream` streams with `addToHistory: false` and only
replays the generation as one ordinary edit on `aiStreamAccept` — that's what makes accept a single
`Ctrl+Z` and discard leave no trace. Don't "fix" the silent transactions. The accept path
deliberately dispatches two transactions itself and sets `preventDispatch`; the empty-block bookkeeping
(`consumedEmptyBlock`) exists so undo lands on the pre-generation document, paragraph included.

**Abort is an outcome, not an error.** `runAITask().done` resolves with the partial text when the user
hits stop; only genuine failures reject. Check with `isAbortError`, don't `throw` on abort.

**Provider and toggles are read through getters.** `AIProviderSource` and `Toggle` accept a function
so a host can swap providers or switch ghost text on after the editor is constructed. Extensions are
built once — resolve on use (`resolveProvider` / `resolveToggle`), never freeze at construction.

**Never bundle ProseMirror.** Both `vite.config.ts` files externalize `@tiptap/*`, `prosemirror-*`,
`lowlight`. A second copy of ProseMirror in a consumer's app breaks the editor at runtime.

**Providers are tree-shakeable subpaths.** Adding one means a new lib entry in
`packages/core/vite.config.ts` *and* a new `exports` key in `packages/core/package.json`.

**Everything that touches the DOM goes through `isBrowser()`.** The SDK is imported in SSR apps.

## Conventions

- User-facing strings are i18n keys in `packages/core/src/i18n/messages.ts` — add to **both** `zhCN`
  and `en`, then resolve with the translator. Never hardcode a string in a component.
- Icons are SVG body strings in `packages/vue/src/icons.ts`, drawn with `currentColor` inside a shared
  `<svg class="ue-ico" viewBox="0 0 24 24">`. Don't add icon component files.
- The upload seam is one function: `(blob, filename?) => Promise<string>`. No HTTP client, no URL, no
  auth logic belongs in the SDK.
- Prettier: single quotes, no trailing commas, width 100. oxlint with `correctness` denied.
- Comments explain *why* — the constraint the code can't show. The existing ones are the house style;
  match their density.

## Shipping

User-facing changes to either package need a changeset (`pnpm changeset`). Pushing to `main` opens or
updates a release PR; merging it publishes to npm. Commit messages follow Conventional Commits with a
Chinese subject and body.
