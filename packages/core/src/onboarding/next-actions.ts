import type { PlatformRole } from '../access';

/**
 * What this person should do next.
 *
 * ## Why this is a pure function
 *
 * "What should I do next" is the hardest question a new marketplace account
 * faces, and the answer is a judgement about a dozen pieces of state. Left in a
 * page component it becomes a pile of nested ternaries nobody can verify, and
 * the failure mode is silent: somebody is shown a step they have already done,
 * or told to do something their role cannot do. Both teach them the product is
 * not paying attention.
 *
 * So the decision lives here, takes a plain object, and is tested against every
 * combination that matters.
 *
 * ## Completed steps are returned, not filtered out
 *
 * A checklist showing only what is left is a list that never gets shorter in a
 * way you can feel. Returning the finished ones lets the surface show progress,
 * which is the part that makes somebody finish. The caller decides how to
 * render them.
 *
 * ## It never suggests something the account cannot do
 *
 * Every action is gated on role. Telling a buyer to list a business, or a
 * seller to set acquisition criteria, is worse than saying nothing: it is a
 * door that does not open, and a few of those and people stop reading.
 */

export interface AccountState {
  roles: PlatformRole[];

  /** Shared */
  hasDisplayName: boolean;
  hasSecondFactor: boolean;

  /** Sell side */
  listingCount: number;
  draftListingCount: number;
  liveListingCount: number;
  /** Live listings whose confidential half is still empty. */
  listingsMissingConfidential: number;
  /** Access requests waiting on the seller to decide. */
  pendingNdaRequests: number;

  /** Buy side */
  hasAcquisitionCriteria: boolean;
  fundingVerification: 'none' | 'pending' | 'verified' | 'rejected';
  savedListingCount: number;
  signedNdaCount: number;
}

export type ActionWeight = 'blocking' | 'important' | 'optional';

export interface NextAction {
  id: string;
  title: string;
  /** One sentence saying why it matters, not what the button does. */
  body: string;
  href: string;
  cta: string;
  weight: ActionWeight;
  done: boolean;
}

const has = (state: AccountState, role: PlatformRole) => state.roles.includes(role);
const sells = (state: AccountState) => has(state, 'seller') || has(state, 'broker');
const buys = (state: AccountState) => has(state, 'buyer');

/**
 * The ordered list.
 *
 * Order is by what unblocks the most, not by how easy each step is. A seller
 * with a live listing and no confidential half has a listing nobody can act on,
 * which matters more than their display name — even though the name is the
 * quicker win.
 */
export function nextActions(state: AccountState): NextAction[] {
  const actions: NextAction[] = [];

  /*
   * Waiting on you, first and always.
   *
   * Somebody else is blocked on this person right now. It outranks every setup
   * step, including ones marked blocking — a half-finished profile costs the
   * account nothing today, and a buyer waiting four days for an answer is a
   * deal going cold.
   */
  if (sells(state) && state.pendingNdaRequests > 0) {
    actions.push({
      id: 'nda-requests',
      title:
        state.pendingNdaRequests === 1
          ? 'A buyer is waiting for your decision'
          : `${state.pendingNdaRequests} buyers are waiting for your decision`,
      body: 'They have asked to see your confidential figures. Nothing is released until you decide.',
      href: '/listings/mine',
      cta: 'Review requests',
      weight: 'blocking',
      done: false,
    });
  }

  // ---- shared -------------------------------------------------------------

  actions.push({
    id: 'display-name',
    title: 'Add your name',
    body: 'The other side of a deal sees who they are dealing with. An unnamed account gets fewer replies.',
    href: '/settings/security',
    cta: 'Add your name',
    weight: 'important',
    done: state.hasDisplayName,
  });

  /*
   * Two-factor authentication, framed as what it unlocks rather than as a
   * chore. It is genuinely required to reach a confidential profile, a deal
   * room or a document, so somebody who skips it hits a wall later — better to
   * meet it here, with an explanation, than mid-deal.
   */
  actions.push({
    id: 'second-factor',
    title: 'Turn on two-factor authentication',
    body: buys(state)
      ? 'Required before you can open a seller’s confidential figures or enter a deal room.'
      : 'Required before you can release your figures to a buyer, and it stops a stolen session doing it for you.',
    href: '/settings/security',
    cta: 'Set it up',
    weight: 'blocking',
    done: state.hasSecondFactor,
  });

  // ---- sell side ----------------------------------------------------------

  if (sells(state)) {
    actions.push({
      id: 'first-listing',
      title: 'List your first business',
      body: 'Your listing is anonymous — industry, state and size ranges only — until you issue a confidentiality agreement.',
      href: '/listings/new',
      cta: 'Create a listing',
      weight: 'blocking',
      done: state.listingCount > 0,
    });

    /*
     * Only once a listing exists. Offering "complete your confidential profile"
     * to somebody with no listing is a step they cannot start.
     */
    if (state.listingCount > 0) {
      actions.push({
        id: 'confidential-half',
        title: 'Complete the confidential half',
        body: 'The exact figures and company name sit behind the NDA gate. A listing without them gives a buyer nothing to sign for.',
        href: '/listings/mine',
        cta: 'Add the details',
        weight: 'important',
        done: state.listingsMissingConfidential === 0,
      });

      actions.push({
        id: 'publish',
        title: 'Put a listing on the market',
        body: 'A draft is visible only to you. Publishing sends it for review and then to buyers.',
        href: '/listings/mine',
        cta: 'Publish',
        weight: 'important',
        done: state.liveListingCount > 0,
      });
    }
  }

  // ---- buy side -----------------------------------------------------------

  if (buys(state)) {
    actions.push({
      id: 'criteria',
      title: 'Set what you are looking for',
      body: 'Sector, size and geography. Without it every listing looks equally relevant, which means none of them do.',
      href: '/tools/buyer-criteria',
      cta: 'Set criteria',
      weight: 'important',
      done: state.hasAcquisitionCriteria,
    });

    /*
     * Worded as leverage rather than as compliance, because that is what it
     * actually is: a seller deciding between two strangers releases their
     * financials to the one whose funding somebody has checked.
     */
    actions.push({
      id: 'funding',
      title:
        state.fundingVerification === 'pending'
          ? 'Your funding is being reviewed'
          : 'Verify your funding',
      body:
        state.fundingVerification === 'pending'
          ? 'Nothing to do — a person is reading what you submitted. Sellers see it as under review until then.'
          : state.fundingVerification === 'rejected'
            ? 'The review did not confirm it. Often that means a document was missing rather than anything about you.'
            : 'Sellers decide who to release their figures to. A reviewed buyer gets answered first.',
      href: '/settings/verification',
      cta: state.fundingVerification === 'none' ? 'Submit evidence' : 'View',
      weight: 'important',
      done: state.fundingVerification === 'verified',
    });

    actions.push({
      id: 'first-request',
      title: 'Request access to a business',
      body: 'Ask a seller for the confidential profile. They see who you are and decide.',
      href: '/listings',
      cta: 'Browse the market',
      weight: 'optional',
      done: state.signedNdaCount > 0,
    });
  }

  return actions;
}

export interface SetupProgress {
  done: number;
  total: number;
  /** 0–100, rounded. 100 only when everything is genuinely finished. */
  percent: number;
  /** The first thing still outstanding, or null when there is nothing left. */
  next: NextAction | null;
}

/**
 * Progress across the setup steps.
 *
 * "Waiting on you" items are excluded from the denominator: they are not setup,
 * they recur, and counting them would mean the checklist drops from 100% every
 * time a buyer asks a question. A bar that goes backwards for doing well is a
 * bar people stop trusting.
 */
export function setupProgress(actions: NextAction[]): SetupProgress {
  const setup = actions.filter((action) => action.id !== 'nda-requests');
  const done = setup.filter((action) => action.done).length;
  const total = setup.length;

  return {
    done,
    total,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    next: actions.find((action) => !action.done) ?? null,
  };
}
