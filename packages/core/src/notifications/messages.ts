/**
 * Every sentence the platform will ever send somebody, in one file.
 *
 * The alternative — building the text at each call site, where the listing and
 * the buyer are both in scope — is how a company's legal name ends up in an
 * email. Not through carelessness exactly: the call site has the row, the row
 * has the name, and `Your listing ${listing.legalName} was viewed` reads like an
 * improvement right up until it is sent to a mail server in plain text.
 *
 * So the call site passes an event and, at most, a count. The words live here,
 * and none of them have a slot for anything confidential.
 *
 * ## The rule, stated once
 *
 * A notification says **that** something happened, never **what**. "Somebody
 * requested access to your listing" and not the buyer's name. "Your listing was
 * returned" and not the reviewer's reason. The link goes to the page where the
 * detailed version lives, behind the session and the policies that already
 * exist.
 *
 * A notification is a doorbell, not a window.
 */

export const NOTIFICATION_KINDS = [
  'nda_requested',
  'nda_signed',
  'listing_approved',
  'listing_returned',
  'new_match',
  'document_opened',
  'nda_issued',
  'nda_revoked',
  'document_released',
  'message_received',
  'task_due',
  'saved_search_match',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * Which preference switch governs a kind.
 *
 * Mapped rather than inferred from the name, because the grouping a user thinks
 * in ("deal activity") is not the grouping the code is organised by, and a
 * seller turning off deal emails means all of it — NDAs, documents, the lot.
 */
export type NotificationCategory = 'deal_activity' | 'new_matches' | 'listing_status' | 'messages';

export const NOTIFICATION_CATEGORY: Record<NotificationKind, NotificationCategory> = {
  nda_requested: 'deal_activity',
  nda_signed: 'deal_activity',
  nda_issued: 'deal_activity',
  nda_revoked: 'deal_activity',
  document_opened: 'deal_activity',
  document_released: 'deal_activity',
  task_due: 'deal_activity',
  new_match: 'new_matches',
  /*
   * Same switch as `new_match`, deliberately. A buyer who turned off "new
   * matches" emails has said they do not want the platform telling them about
   * listings; that a different mechanism produced this one is an implementation
   * detail they never agreed to be re-subscribed by.
   */
  saved_search_match: 'new_matches',
  listing_approved: 'listing_status',
  listing_returned: 'listing_status',
  message_received: 'messages',
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  deal_activity: 'Deal activity',
  new_matches: 'New matches',
  listing_status: 'My listings',
  messages: 'Messages',
};

export const CATEGORY_HINTS: Record<NotificationCategory, string> = {
  deal_activity: 'Access requests, signatures, documents opened or released.',
  new_matches: 'When a buyer matching your business joins, or a business matches your criteria.',
  listing_status: 'When your listing is published, returned, or its status changes.',
  messages: 'When somebody writes to you in a deal room.',
};

export interface NotificationCopy {
  title: string;
  body: string | null;
}

/**
 * The only variable a message may carry.
 *
 * A number. Not a name, not an amount, not a headline — a number is the one
 * thing that cannot identify a business by accident, and "3 buyers" is as much
 * as anybody needs before clicking through.
 */
export interface NotificationContext {
  count?: number;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

export function notificationCopy(
  kind: NotificationKind,
  context: NotificationContext = {},
): NotificationCopy {
  const count = context.count ?? 1;

  switch (kind) {
    case 'nda_requested':
      return {
        title: 'Someone asked to see your business',
        body: 'A buyer has requested a confidentiality agreement. You decide whether to send one — you can see who they are first.',
      };

    case 'nda_signed':
      return {
        title: 'A buyer signed your NDA',
        body: 'They can now see the confidential half of your listing. You can withdraw that access at any time.',
      };

    case 'nda_issued':
      return {
        title: 'A seller sent you an agreement',
        body: 'Sign it to see the full details of the business.',
      };

    case 'nda_revoked':
      return {
        title: 'Access was withdrawn',
        body: 'A seller has ended your access to a listing. Anything you already downloaded is unaffected.',
      };

    case 'listing_approved':
      return {
        title: 'Your listing is on the market',
        body: 'Buyers can now find it. Only the anonymous half is public.',
      };

    case 'listing_returned':
      return {
        title: 'Your listing came back with notes',
        // Deliberately not the reason. The reviewer's note is on the listing,
        // behind the session — an email saying "the headline names the
        // business" would say the quiet part in a channel that is not private.
        body: 'A reviewer sent it back before publishing. Open it to see what they asked for.',
      };

    case 'new_match':
      return {
        title: count === 1 ? 'A new match' : `${count} new matches`,
        body: `${plural(count, 'buyer is', 'buyers are')} looking for something like your business.`,
      };

    case 'document_opened':
      return {
        title: 'Somebody opened your document',
        body: 'A document you released has been opened. The full record is on the deal.',
      };

    case 'document_released':
      return {
        title: 'A document was shared with you',
        body: 'Something new is available in a deal room you are part of.',
      };

    case 'message_received':
      return {
        title: count === 1 ? 'A new message' : `${count} new messages`,
        // Never the message. This is the most tempting one to preview and the
        // worst: a deal room message can contain a price, a name, or a term
        // somebody is still negotiating.
        body: 'Open the deal room to read it.',
      };

    case 'task_due':
      return {
        title: count === 1 ? 'A task is due' : `${count} tasks are due`,
        body: 'From your pipeline.',
      };

    case 'saved_search_match':
      return {
        title:
          count === 1 ? 'A business matching your search' : `${count} businesses match your search`,
        /*
         * Not the headline, and not the sector.
         *
         * Every other body here withholds detail because the detail is
         * confidential. This one withholds it for a different reason: the
         * subject line of an email sitting in a preview pane is not a place to
         * put "HVAC contractor in Ohio" when the recipient may be reading it in
         * an open-plan office, and the same buyer may hold six searches whose
         * names they chose precisely so nobody else could read them.
         */
        body: 'Open your saved searches to see what came up.',
      };
  }
}

/**
 * Where a notification points.
 *
 * A path, never a URL. The domain belongs to the deployment, and an absolute URL
 * stored in a row is how a notification written on staging links a customer to
 * staging six months later.
 */
export function notificationHref(kind: NotificationKind, entityId?: string | null): string {
  switch (kind) {
    case 'nda_requested':
    case 'nda_signed':
    case 'listing_approved':
    case 'listing_returned':
      return entityId ? `/listings/${entityId}` : '/listings/mine';

    case 'nda_issued':
    case 'nda_revoked':
      return entityId ? `/listings/${entityId}` : '/watchlist';

    case 'new_match':
      return '/matches';

    case 'saved_search_match':
      return '/saved-searches';

    case 'document_opened':
    case 'document_released':
      return entityId ? `/deals/${entityId}/documents` : '/deals';

    case 'message_received':
      return entityId ? `/deals/${entityId}/messages` : '/deals';

    case 'task_due':
      return '/crm';
  }
}
