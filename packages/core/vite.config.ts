import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

// Library build: multiple entries so the AI providers stay tree-shakeable subpaths.
// Types are emitted separately by `tsc -p tsconfig.build.json` (see package.json).
export default defineConfig({
  define: {
    __ULTRA_EDITOR_VERSION__: JSON.stringify(packageJson.version)
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    lib: {
      entry: {
        index: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
        lean: fileURLToPath(new URL('./src/lean.ts', import.meta.url)),
        'providers/openai': fileURLToPath(new URL('./src/providers/openai.ts', import.meta.url)),
        'providers/anthropic': fileURLToPath(
          new URL('./src/providers/anthropic.ts', import.meta.url)
        )
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => `${name}.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      // Everything shipped as a dependency stays external — the SDK must never
      // bundle a second copy of ProseMirror into the consumer's app.
      external: [/^@tiptap\//, /^prosemirror-/, 'lowlight', /^highlight\.js/]
    }
  }
});
