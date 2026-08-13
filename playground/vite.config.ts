import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const corePackageJson = JSON.parse(
  readFileSync(new URL('../packages/core/package.json', import.meta.url), 'utf8')
) as { version: string };

// Alias straight to source so playground hot-reloads on SDK edits without a rebuild.
export default defineConfig({
  plugins: [vue()],
  define: {
    __ULTRA_EDITOR_VERSION__: JSON.stringify(corePackageJson.version)
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'prosemirror',
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?prosemirror-/,
              priority: 30
            },
            {
              name: 'tiptap',
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?@tiptap[\\/]/,
              priority: 20
            },
            {
              name: 'vue',
              test: /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@vue[\\/]|vue[\\/])/,
              priority: 10
            }
          ]
        }
      }
    }
  },
  resolve: {
    alias: {
      '@ultra-editor/core/styles.css': fileURLToPath(
        new URL('../packages/core/styles/index.css', import.meta.url)
      ),
      '@ultra-editor/core/providers/openai': fileURLToPath(
        new URL('../packages/core/src/providers/openai.ts', import.meta.url)
      ),
      '@ultra-editor/core/providers/anthropic': fileURLToPath(
        new URL('../packages/core/src/providers/anthropic.ts', import.meta.url)
      ),
      '@ultra-editor/core/lean': fileURLToPath(
        new URL('../packages/core/src/lean.ts', import.meta.url)
      ),
      '@ultra-editor/core': fileURLToPath(
        new URL('../packages/core/src/index.ts', import.meta.url)
      ),
      '@ultra-editor/vue': fileURLToPath(new URL('../packages/vue/src/index.ts', import.meta.url))
    }
  },
  server: {
    port: 5174,
    host: '0.0.0.0'
  }
});
