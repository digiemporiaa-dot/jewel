import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

/**
 * Flat config, because Next 16 removed `next lint`.
 *
 * The rules are unchanged — `next/core-web-vitals`, exactly what the old
 * `.eslintrc.json` extended — but they run through the ESLint CLI now.
 * `eslint-config-next` 16 publishes flat config directly, so no compatibility
 * shim is involved.
 */
export default [
  {
    // `next lint` knew to skip these; the CLI has to be told.
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'prisma/migrations/**', '*.mjs'],
  },
  ...nextCoreWebVitals,
];
