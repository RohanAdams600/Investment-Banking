import Link from 'next/link';
import { brand, isBrandFullyConfigured, unconfiguredBrandFields } from '@ib/core';

/**
 * The footer, and the disclosure it carries.
 *
 * Two jobs. The obvious one is making the legal pages reachable — a marketplace
 * whose terms are only findable by typing the URL does not really have terms.
 *
 * The second is the line about what Cairn is not. A platform that hosts
 * valuations, matches buyers to sellers and drafts documents looks like a
 * broker, and in most states being one requires a licence. Saying plainly and in
 * every page's footer that the platform is not acting as anybody's broker,
 * lawyer or advisor is cheap, and the absence of it is the kind of thing that
 * gets argued about later.
 *
 * The placeholder warning is deliberately ugly. `supportEmail` and
 * `mailingAddress` default to development values, and a footer quietly shipping
 * `support@example.com` is exactly the sort of thing that survives to launch —
 * so it is loud until it is configured, and invisible afterwards.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-border-subtle mt-16 border-t">
      <div className="text-text-muted mx-auto max-w-5xl space-y-4 px-6 py-8 text-xs">
        {!isBrandFullyConfigured ? (
          <p className="border-warning/40 bg-warning-subtle text-warning rounded border p-3">
            Not configured for launch: {unconfiguredBrandFields.join(', ')} still use development
            defaults. Set <code>BRAND_SUPPORT_EMAIL</code> and <code>BRAND_MAILING_ADDRESS</code>.
          </p>
        ) : null}

        <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legal">
          <Link
            href="/legal/terms"
            className="hover:text-text-secondary underline-offset-4 hover:underline"
          >
            Terms of use
          </Link>
          <Link
            href="/legal/privacy"
            className="hover:text-text-secondary underline-offset-4 hover:underline"
          >
            Privacy
          </Link>
          <Link
            href="/legal/licensing"
            className="hover:text-text-secondary underline-offset-4 hover:underline"
          >
            Broker licensing
          </Link>
          <Link
            href="/legal/not-securities"
            className="hover:text-text-secondary underline-offset-4 hover:underline"
          >
            Not a securities offering
          </Link>
        </nav>

        <p className="max-w-3xl leading-relaxed">
          {brand.name} is a marketplace. It is not your broker, your attorney, your accountant or
          your investment advisor, and nothing on it is legal, tax or investment advice. Valuations
          are estimates for discussion. Whether a business may be listed or sold in a given state,
          and by whom, is a question for your own counsel.
        </p>

        <p>
          © {year} {brand.name}
          {isBrandFullyConfigured ? ` · ${brand.mailingAddress} · ${brand.supportEmail}` : ''}
        </p>
      </div>
    </footer>
  );
}
