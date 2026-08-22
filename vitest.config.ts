import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  // tsconfig sets jsx:"preserve" for Next, which esbuild will not transform.
  // Overriding here lets component tests render without pulling in a Vite React
  // plugin (whose current major wants a Vite newer than vitest 2 allows).
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  test: {
    // Node by default — most suites are pure logic and start faster without a
    // DOM. The few component tests opt in with a docblock pragma.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
