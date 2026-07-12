import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// All styling lives in @ultra-editor/core/styles — the Vue components carry no
// scoped CSS, so this build emits JS only and consumers import one stylesheet.
export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`
    },
    rollupOptions: {
      external: [
        'vue',
        /^@tiptap\//,
        /^@ultra-editor\//,
        /^prosemirror-/,
        'lowlight',
        /^highlight\.js/
      ],
      output: {
        globals: { vue: 'Vue' }
      }
    }
  }
});
