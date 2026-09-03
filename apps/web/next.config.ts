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
          /*
           * Cross-origin isolation.
           *
           * `X-Frame-Options: DENY` above stops this site being framed. These
           * two stop the reverse and the sideways cases, which it does not
           * cover:
           *
           * COOP severs the `window.opener` relationship with anything this
           * page opens or is opened by, so a page on another origin cannot hold
           * a handle to a document-viewer tab and navigate or probe it. It is
           * also what closes the cross-window half of the XS-Leak family, where
           * a malicious opener infers content from timing and frame counts
           * without ever reading it.
           *
           * CORP declares that no other origin may embed our responses as a
           * subresource — an <img>, a <script>, a <link>. Without it a
           * watermarked PDF served to a signed-in viewer can be pulled into an
           * attacker's page by URL, and the browser will happily attach the
           * session cookie.
           *
           * `same-origin` for both rather than `same-site`: there are no
           * sibling subdomains that need to embed this, and nothing here is
           * meant to be consumed by another origin at all.
           */
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
        ],
      },
      /*
       * The three routes that exist to be loaded cross-origin.
       *
       * `Cross-Origin-Resource-Policy: same-origin` above is the right default
       * and the wrong answer for a share image. A link preview is a browser on
       * somebody else's origin fetching `/opengraph-image` as a subresource,
       * which is exactly what CORP blocks — so the blanket rule would have made
       * every shared link render without its card, on the surface the product
       * most depends on for reach.
       *
       * Listed later so it wins: Next applies every matching rule in order and
       * the last value for a key takes effect.
       *
       * These three carry nothing confidential. The root image is the brand
       * card; the per-listing one is generated from teaser fields only and sits
       * behind the app's auth boundary regardless, so no crawler reaches it.
       */
      {
        source: '/:path(opengraph-image|icon.svg)',
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }],
      },
      {
        source: '/:prefix*/opengraph-image-:hash',
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }],
      },
    ];
  },
};

export default nextConfig;
