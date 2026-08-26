import 'server-only';

import { z } from 'zod';

import { INDUSTRY_PROFILES, estimateValuation, matchStrength, type IndustryKey } from '@ib/core';

import { hasScope, type McpScope, type McpSession } from './auth';

/**
 * What an external agent may do.
 *
 * ## The allowlist is the feature
 *
 * This file is the second of three independent places the platform's standing
 * constraint is enforced: **an agent may read anything its owner could read and
 * may write a draft, but nothing here transmits anything to another human
 * being.** There is no `send_message`, no `issue_nda`, no `publish_listing`, and
 * no `approve_outreach`. Adding one is not a small change — it is the change
 * that turns a research assistant into something that can contact a business
 * owner unattended.
 *
 * The other two places: `app.mcp_scope` has no value meaning "send", and every
 * query below runs under the owner's own RLS session, so a tool cannot reach a
 * row its owner could not.
 *
 * ## Why the results say what they are
 *
 * An agent will paste these into a document, and the document will be read by
 * somebody who never saw this platform. So a valuation carries its disclaimer in
 * the payload rather than in the UI that is not there, and a match score carries
 * the reasoning that produced it. A number travelling without its caveat is the
 * failure mode of the whole integration.
 */

export interface McpTool {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  inputSchema: z.ZodType;
  run: (session: McpSession, input: unknown) => Promise<unknown>;
}

/** Never returned to an agent without this attached. */
const ESTIMATE_NOTICE =
  'Informational only. This is an estimate for discussion, not an appraisal, a fairness opinion, or a recommendation to buy or sell at any price. It is calculated from figures the seller supplied and ignores everything diligence would find.';

const searchListings: McpTool = {
  name: 'search_listings',
  title: 'Search businesses for sale',
  description:
    'Search the marketplace by industry, state, earnings and asking price. Returns anonymised teasers only — the company name, address and exact figures are never included, regardless of who is asking.',
  scope: 'read:listings',
  inputSchema: z.object({
    industry: z.enum(Object.keys(INDUSTRY_PROFILES) as [string, ...string[]]).optional(),
    state: z
      .string()
      .regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/)
      .optional(),
    minEarningsCents: z.number().int().min(0).optional(),
    maxAskingCents: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  async run(session, input) {
    const args = this.inputSchema.parse(input) as {
      industry?: string;
      state?: string;
      minEarningsCents?: number;
      maxAskingCents?: number;
      limit: number;
    };

    let query = session.db
      .from('listings')
      .select(
        'id, headline, summary, background, industry, jurisdiction_code, ' +
          'revenue_band_low_cents, revenue_band_high_cents, ' +
          'earnings_band_low_cents, earnings_band_high_cents, ' +
          'asking_price_band_low_cents, asking_price_band_high_cents, ' +
          'employee_count, years_in_business, growth_trend, owner_dependence, published_at',
      )
      .in('status', ['live', 'under_loi', 'under_contract'])
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(args.limit);

    if (args.industry) query = query.eq('industry', args.industry);
    if (args.state) query = query.eq('jurisdiction_code', args.state);
    if (args.minEarningsCents !== undefined) {
      query = query.gte('earnings_band_high_cents', args.minEarningsCents);
    }
    if (args.maxAskingCents !== undefined) {
      query = query.lte('asking_price_band_low_cents', args.maxAskingCents);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Search failed: ${error.message}`);

    return {
      listings: data ?? [],
      note: 'Teasers only. A full profile requires a confidentiality agreement the seller issued and a person signed.',
    };
  },
};

const getListing: McpTool = {
  name: 'get_listing',
  title: 'Read one listing',
  description:
    "Read a single listing. Returns the anonymised teaser. The confidential profile — company name, exact financials, customers — is returned only if the token owner has already signed that seller's NDA, and the database enforces that, not this tool.",
  scope: 'read:listings',
  inputSchema: z.object({ listingId: z.string().uuid() }),
  async run(session, input) {
    const { listingId } = this.inputSchema.parse(input) as { listingId: string };

    const [teaser, details] = await Promise.all([
      session.db.from('listings').select('*').eq('id', listingId).maybeSingle(),
      /*
       * Not a privileged read. This is the same request a browser makes; the
       * policy on `listing_details` returns a row or does not, and "does not" is
       * the normal answer. The tool never inspects an NDA itself — re-deriving
       * the gate here is how the two answers drift apart.
       */
      session.db.from('listing_details').select('*').eq('listing_id', listingId).maybeSingle(),
    ]);

    if (!teaser.data) {
      return { found: false, note: 'No listing with that id is visible to you.' };
    }

    return {
      found: true,
      teaser: teaser.data,
      confidentialProfile: details.data ?? null,
      ndaGate: details.data
        ? 'Open. A signed confidentiality agreement is on file.'
        : 'Closed. Request access in the application; nothing here can open it.',
    };
  },
};

const listMatches: McpTool = {
  name: 'list_matches',
  title: "Read the owner's match scores",
  description:
    "Return listings scored against the token owner's acquisition criteria, with the reasoning behind each score. Ranked by fit — paid placement does not affect this ordering.",
  scope: 'read:matches',
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  async run(session, input) {
    const { limit } = this.inputSchema.parse(input) as { limit: number };

    const { data, error } = await session.db
      .from('match_scores')
      .select('listing_id, score, reasons, excluded, exclusion_reasons, computed_at')
      .order('score', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Matches unavailable: ${error.message}`);

    return {
      matches: (data ?? []).map((row) => ({
        ...row,
        strength: matchStrength(row.score as number),
      })),
      note: 'Scores are calculated from criteria the buyer stated and figures the seller supplied. They are a ranking aid, not advice about whether to pursue a business.',
    };
  },
};

const listTasks: McpTool = {
  name: 'list_tasks',
  title: 'Read the pipeline',
  description:
    "Open tasks and their due dates across the token owner's deals. Message bodies are never included.",
  scope: 'read:pipeline',
  inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
  async run(session, input) {
    const { limit } = this.inputSchema.parse(input) as { limit: number };

    const { data, error } = await session.db
      .from('crm_tasks')
      .select('id, title, status, due_at, contact_id, created_at')
      .neq('status', 'done')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) throw new Error(`Pipeline unavailable: ${error.message}`);
    return { tasks: data ?? [] };
  },
};

const draftOutreach: McpTool = {
  name: 'draft_outreach',
  title: 'Write an outreach draft for a human to review',
  description:
    'Write a draft introduction into the approval queue. THIS DOES NOT SEND ANYTHING. The draft appears in the application for a person to read, edit, and send — or discard. There is no tool on this server that sends a message, and asking for one will not produce it.',
  scope: 'draft:outreach',
  inputSchema: z.object({
    listingId: z.string().uuid(),
    recipientId: z.string().uuid(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().min(20).max(4000),
  }),
  async run(session, input) {
    const args = this.inputSchema.parse(input) as {
      listingId: string;
      recipientId: string;
      subject?: string;
      body: string;
    };

    const { data, error } = await session.db
      .from('outreach_drafts')
      .insert({
        listing_id: args.listingId,
        recipient_id: args.recipientId,
        created_by: session.userId,
        subject: args.subject ?? null,
        body: args.body,
        status: 'draft',
        /*
         * Provenance, in the column the schema already had for it. A recipient
         * asking "why did this reach me" gets an answer, and a bad batch is
         * traceable to the agent that produced it rather than to a person who
         * only clicked approve.
         */
        generated_by: 'mcp-agent',
      })
      .select('id, status')
      .maybeSingle();

    if (error) throw new Error(`Could not save the draft: ${error.message}`);

    return {
      draft: data,
      sent: false,
      note: 'Saved as a draft only. A person must open it in the application and click send. Nothing on this platform contacts anyone on an agent’s behalf.',
    };
  },
};

const runValuation: McpTool = {
  name: 'run_valuation',
  title: 'Estimate what a business might be worth',
  description:
    'Run the deterministic valuation engine. Touches no stored record. Returns a range with every factor that moved the multiple itemised, so the estimate can be argued with rather than quoted. It is an estimate for discussion, never a price.',
  scope: 'run:valuation',
  inputSchema: z.object({
    industry: z.enum(Object.keys(INDUSTRY_PROFILES) as [string, ...string[]]),
    revenueCents: z.number().int().min(0),
    sdeCents: z.number().int().optional(),
    ebitdaCents: z.number().int().optional(),
    customerConcentration: z.number().min(0).max(1).optional(),
    recurringRevenueShare: z.number().min(0).max(1).optional(),
    revenueGrowth: z.number().min(-1).max(10).optional(),
    yearsInBusiness: z.number().int().min(0).max(200).optional(),
    ownerDependence: z.enum(['absentee', 'moderate', 'critical']).optional(),
    employeeCount: z.number().int().min(0).optional(),
  }),
  async run(_session, input) {
    const args = this.inputSchema.parse(input) as {
      industry: string;
      revenueCents: number;
      sdeCents?: number;
      ebitdaCents?: number;
      customerConcentration?: number;
      recurringRevenueShare?: number;
      revenueGrowth?: number;
      yearsInBusiness?: number;
      ownerDependence?: 'absentee' | 'moderate' | 'critical';
      employeeCount?: number;
    };

    const result = estimateValuation({
      industry: args.industry as IndustryKey,
      revenue: args.revenueCents,
      sde: args.sdeCents,
      ebitda: args.ebitdaCents,
      customerConcentration: args.customerConcentration,
      recurringRevenueShare: args.recurringRevenueShare,
      revenueGrowth: args.revenueGrowth,
      yearsInBusiness: args.yearsInBusiness,
      ownerDependence: args.ownerDependence,
      employeeCount: args.employeeCount,
    });

    return {
      /*
       * The inputs, the factors and the disclaimer travel with the number on
       * purpose. An agent will paste this into a document read by somebody who
       * never saw the form, and an estimate whose assumptions arrived separately
       * is an estimate that gets quoted as a price.
       */
      inputs: args,
      valuation: result,
      disclaimer: ESTIMATE_NOTICE,
      note: 'Every factor that moved the multiple is listed. If one of them is wrong, the estimate is wrong — say so alongside the number rather than presenting the range on its own.',
    };
  },
};

/**
 * The complete set. There is no export that lets a caller extend it at runtime,
 * so the answer to "what can this agent do" is this list and nothing else.
 */
export const MCP_TOOLS: readonly McpTool[] = [
  searchListings,
  getListing,
  listMatches,
  listTasks,
  runValuation,
  draftOutreach,
];

export function toolsFor(session: McpSession): McpTool[] {
  return MCP_TOOLS.filter((tool) => hasScope(session, tool.scope));
}

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}
