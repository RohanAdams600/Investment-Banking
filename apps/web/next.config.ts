import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than a build artifact, so
  // Next compiles them alongside the app. This keeps the packages editable
  // without a watch/rebuild step during development.
  transpilePackages: ['@ib/ui', '@ib/core'],

  typescript: {
    // Type errors must fail the build. CI runs `typecheck` separately as well,
    // so a regression is caught before it reaches a deploy.
    ignoreBuildErrors: false,
  },

  eslint: {
    ignoreDuringBuilds: false,
  },

  /*
   * Baseline security headers.
   *
   * The CSP is **not** here: it needs a per-request nonce, so it is set in
   * `src/middleware.ts` where one can be minted. These are the headers that are
   * the same for every response.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
