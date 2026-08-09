import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The database tests live outside any workspace package, so the package
      // names are not on their resolution path. Aliasing to source also means
      // they exercise the same files the app compiles, not a stale build.
      '@ib/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@ib/ui': resolve(__dirname, 'packages/ui/src/index.ts'),
    },
  },
  esbuild: {
    // Token and component modules are .tsx; the automatic runtime lets tests
    // import them without a React import in every file.
    jsx: 'automatic',
  },
  test: {
    include: [
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'apps/**/*.test.ts',
      'supabase/**/*.test.ts',
    ],
    // The RLS suite drives one shared database and mutates it; running files in
    // parallel against the same instance would make the assertions race.
    fileParallelism: false,
    exclude: ['**/node_modules/**', '**/.next/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**'],
    },
  },
});
