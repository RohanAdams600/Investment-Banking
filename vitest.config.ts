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
      /*
       * `server-only` throws on import outside a React Server Component, which
       * is the point of it — but it also makes a pure function in a server
       * module untestable. Aliased to an empty module here so the guard stays
       * real in the build and does not block a unit test of the logic beside it.
       */
      'server-only': resolve(__dirname, 'supabase/tests/server-only-stub.ts'),
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
