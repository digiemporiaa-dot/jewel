import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // The real package throws unless it is imported from a React Server
      // Component, which would make every server module untestable. See the
      // stub for why that guard does not apply here.
      'server-only': resolve(__dirname, 'tests/stubs/server-only.ts'),
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
