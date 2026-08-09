import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    // Token and component modules are .tsx; the automatic runtime lets tests
    // import them without a React import in every file.
    jsx: 'automatic',
  },
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**'],
    },
  },
});
