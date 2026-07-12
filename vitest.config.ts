import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@ultra-editor/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@ultra-editor/vue': fileURLToPath(new URL('./packages/vue/src/index.ts', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.{ts,vue}'],
      // Only true barrels and type-only modules are excluded. `upload/index.ts`
      // and `i18n/index.ts` are named index but carry real logic, so a blanket
      // `**/index.ts` would quietly drop them from the denominator.
      exclude: [
        '**/*.test.ts',
        'packages/*/tests/**',
        'packages/core/src/index.ts',
        'packages/core/src/ai/index.ts',
        'packages/core/src/extensions/index.ts',
        'packages/vue/src/index.ts',
        'packages/vue/src/types.ts'
      ],
      // The suite covers every reachable line and branch. A handful of guards that
      // the type system demands but the runtime cannot reach are marked with
      // `/* v8 ignore */` at the source, each with the reason it cannot fire — so a
      // drop below 100 means a real gap, not a rounding error.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
});
