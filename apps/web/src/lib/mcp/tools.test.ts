import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The constraint this integration exists under.
 *
 * **No agent sends anything to another person without a human clicking send.**
 * Connecting an external model is precisely the moment that rule gets lost — not
 * maliciously, but because a plausible next tool is `send_message` and nothing
 * would stop somebody adding it on a Tuesday.
 *
 * The rule is enforced in three independent places, and this file asserts the
 * one that lives in TypeScript. The other two are the `app.mcp_scope` enum,
 * which has no value meaning "send", and RLS, which means a tool cannot reach a
 * row its owner could not.
 *
 * These read the source rather than executing the tools, because what is being
 * defended is the shape of the file: which tools exist at all. A behavioural
 * test cannot assert the absence of a tool nobody wrote yet.
 */

const TOOLS = readFileSync(new URL('./tools.ts', import.meta.url).pathname, 'utf8');
const ROUTE = readFileSync(new URL('../../app/api/mcp/route.ts', import.meta.url).pathname, 'utf8');
const MIGRATION = readFileSync(
  new URL('../../../../../supabase/migrations/0032_mcp_tokens.sql', import.meta.url).pathname,
  'utf8',
);

/** Every tool name declared in the file, read off the literals. */
function declaredToolNames(): string[] {
  return [...TOOLS.matchAll(/^\s*name:\s*'([a-z_]+)',$/gm)].map((match) => match[1]!);
}

describe('what an MCP agent may do', () => {
  it('exposes exactly the tools that were reviewed', () => {
    /*
     * A new tool failing this is the point. Adding one to this list should be a
     * deliberate act in a diff somebody reads, not a line that arrives with a
     * feature and is noticed by nobody.
     */
    expect(declaredToolNames().sort()).toEqual([
      'draft_outreach',
      'get_listing',
      'list_matches',
      'list_tasks',
      'run_valuation',
      'search_listings',
    ]);
  });

  it('has no tool that transmits anything to another person', () => {
    const forbidden = /\bname:\s*'(send|email|sms|notify|publish|issue|approve)_/;
    expect(TOOLS).not.toMatch(forbidden);
  });

  it('never writes a status that means the message went out', () => {
    // `outreach_drafts.status` is the column that decides whether something was
    // sent. An agent may write 'draft' into it and nothing else.
    const statusWrites = [...TOOLS.matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(statusWrites).toEqual(['draft']);
  });

  it('never approves its own draft', () => {
    // Approval is the human's act. Writing approved_by from here would satisfy
    // the schema's constraint while defeating the thing it protects.
    expect(TOOLS).not.toMatch(/approved_by/);
    expect(TOOLS).not.toMatch(/approved_at/);
    expect(TOOLS).not.toMatch(/sent_at/);
  });

  it('records that a draft came from an agent', () => {
    // So a recipient asking "why did this reach me" has an answer, and a bad
    // batch traces to the agent rather than to whoever clicked approve.
    expect(TOOLS).toMatch(/generated_by:\s*'mcp-agent'/);
  });

  it('tells the agent, in the tool description, that nothing is sent', () => {
    // Belt and braces: a model reading only the tool list should not have to
    // infer the boundary from the absence of a send tool.
    const draftBlock = TOOLS.slice(TOOLS.indexOf("name: 'draft_outreach'"));
    expect(draftBlock).toMatch(/DOES NOT SEND/);
  });
});

describe('what an MCP agent may reach', () => {
  it('never uses the service role for a tool query', () => {
    /*
     * The whole design. Tools query through the token owner's own session so
     * Row Level Security decides what comes back. A service-role client here
     * would silently return every row in the database and no policy would object.
     */
    expect(TOOLS).not.toMatch(/createServiceRoleClient|service_role|SERVICE_ROLE/);
  });

  it('does not re-derive the NDA gate in TypeScript', () => {
    // `get_listing` asks for listing_details and takes the answer. Checking the
    // NDA here as well is how two answers to one question drift apart.
    const block = TOOLS.slice(
      TOOLS.indexOf("name: 'get_listing'"),
      TOOLS.indexOf("name: 'list_matches'"),
    );
    expect(block).not.toMatch(/from\('ndas'\)|nda_status|signed_at/);
  });

  it('carries the estimate disclaimer in the payload, not the interface', () => {
    // There is no interface. An agent pastes this into a document somebody else
    // reads, so the caveat has to travel with the number.
    expect(TOOLS).toMatch(/not an appraisal/i);
    expect(TOOLS).toMatch(/disclaimer:\s*ESTIMATE_NOTICE/);
  });
});

describe('the route', () => {
  it('refuses every caller when the signing secret is unset', () => {
    // A misconfigured auth boundary that still answers is worse than one that
    // does not answer at all.
    expect(ROUTE).toMatch(/isMcpConfigured\(\)/);
    expect(ROUTE).toMatch(/503/);
  });

  it('gives one answer to every authentication failure', () => {
    // Unknown, revoked, expired and malformed must be indistinguishable.
    expect(ROUTE).toMatch(/function unauthorized\(\)/);
    expect(ROUTE.match(/status:\s*401/g) ?? []).toHaveLength(1);
  });

  it('hides tools a token may not use rather than refusing them differently', () => {
    // Otherwise any valid token can enumerate the full surface, including tools
    // a narrower scope was chosen to exclude.
    expect(ROUTE).toMatch(/!tool \|\| !toolsFor\(session\)\.includes\(tool\)/);
  });
});

describe('the scope enum', () => {
  it('has no scope that means send', () => {
    const scopes = [...MIGRATION.matchAll(/^\s*'([a-z:]+)',?$/gm)].map((m) => m[1]!);
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      expect(scope, `scope "${scope}"`).not.toMatch(/send|publish|issue|approve|transmit/);
    }
  });

  it('stores a digest rather than the token', () => {
    expect(MIGRATION).toMatch(/token_sha256/);
    expect(MIGRATION).not.toMatch(/token_plaintext|token text not null/);
  });

  it('refuses a token that never expires', () => {
    expect(MIGRATION).toMatch(/expires_at timestamptz not null/);
  });
});
