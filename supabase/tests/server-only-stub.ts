/**
 * Stands in for the `server-only` package under vitest.
 *
 * The real package throws on import unless it is being resolved by a React
 * Server Component bundler, which is exactly what makes it useful in the build
 * and impossible in a unit test. Aliased in `vitest.config.ts`.
 *
 * This changes nothing about the application: the production build still
 * resolves the real package, so a server module imported from a client
 * component is still a build error.
 */
export {};
