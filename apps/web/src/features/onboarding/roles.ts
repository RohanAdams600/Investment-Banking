import type { PlatformRole } from '@ib/core';

/**
 * The roles a person can choose for themselves during onboarding.
 *
 * `admin` is absent, and that is the point. The RLS policy on `user_roles`
 * already refuses a self-granted admin row, so listing it here would produce an
 * option that fails on submit — but more importantly, an onboarding screen that
 * offers "administrator" invites people to try. Admin is granted out of band by
 * an operator using the service role.
 *
 * Descriptions are written for someone who has not used a platform like this
 * and does not know whether they are a "search fund" or a "family office". The
 * distinction between several of these is genuinely subtle, so the copy leads
 * with what the person does rather than what the category is called.
 */

export interface RoleOption {
  role: PlatformRole;
  label: string;
  description: string;
  /** Grouped so the two sides of the market are visually distinct. */
  side: 'sell' | 'buy' | 'advise';
}

export const ROLE_OPTIONS: RoleOption[] = [
  {
    role: 'seller',
    label: 'I own a business I might sell',
    description: 'List a business, control who sees its details, and run the sale process.',
    side: 'sell',
  },
  {
    role: 'buyer',
    label: 'I want to buy a business to run',
    description: 'Browse listings, set acquisition criteria, and approach sellers.',
    side: 'buy',
  },
  {
    role: 'search_fund',
    label: 'I am searching full-time to acquire',
    description:
      'A searcher backed by investors or self-funded, looking for one business to buy and run.',
    side: 'buy',
  },
  {
    role: 'private_equity',
    label: 'I invest on behalf of a fund',
    description:
      'Platform and add-on acquisitions against a fund mandate, with a defined hold period.',
    side: 'buy',
  },
  {
    role: 'family_office',
    label: 'I invest family capital directly',
    description: 'Direct investments with a longer hold horizon and higher discretion by default.',
    side: 'buy',
  },
  {
    role: 'investor',
    label: 'I provide capital to deals',
    description: 'Evaluate deal flow as a capital provider rather than an operator.',
    side: 'buy',
  },
  {
    role: 'broker',
    label: 'I represent sellers as an intermediary',
    description:
      'Manage listings for clients, run deal rooms, and configure commission arrangements.',
    side: 'advise',
  },
];

export const SELECTABLE_ROLES: PlatformRole[] = ROLE_OPTIONS.map((option) => option.role);

export interface OnboardingState {
  error: string | null;
  notice: string | null;
}

export const emptyOnboardingState: OnboardingState = { error: null, notice: null };
