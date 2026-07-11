import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Alias straight to source so playground hot-reloads on SDK edits without a rebuild.
export default defineConfig({
  plugins: [vue()],
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
