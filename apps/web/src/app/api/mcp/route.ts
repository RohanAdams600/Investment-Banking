import { NextResponse } from 'next/server';

import { brand } from '@ib/core';

import { authenticate, bearerFrom, isMcpConfigured, type McpSession } from '@/lib/mcp/auth';
import { findTool, toolsFor } from '@/lib/mcp/tools';

/**
 * The MCP endpoint.
 *
 * Speaks JSON-RPC 2.0 over POST, which is what the Streamable HTTP transport is
 * once the streaming half is set aside. Every tool here returns a single result;
 * nothing needs a server-initiated notification, so the connection is a plain
 * request and response and there is no session to keep.
 *
 * ## What this route refuses
 *
 * A method it does not implement, a tool not in the allowlist, a tool the
 * token's scopes do not cover, and any request at all when MCP is unconfigured.
 * The last one matters: an unset signing secret means every caller is refused
 * rather than silently downgraded to something that works, because a misconfigured
 * auth boundary that still answers is worse than one that does not.
 *
 * ## What it cannot do
 *
 * Send anything to anybody. There is no tool for it. See `lib/mcp/tools.ts`.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PROTOCOL_VERSION = '2025-06-18';

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC reserved codes, plus the one this route adds. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function rpcError(id: string | number | null, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } });
}

function rpcResult(id: string | number | null, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id, result });
}

/**
 * One 401 for every authentication failure.
 *
 * Unknown token, revoked token, expired token and malformed header all produce
 * this. Distinguishing them would tell a caller which half of a guess was right.
 */
function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: INVALID_REQUEST, message: 'Unauthorized.' } },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="mcp"' } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isMcpConfigured()) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: INTERNAL_ERROR,
          message:
            'MCP is not configured on this deployment. SUPABASE_JWT_SECRET is unset, so no agent session can be established.',
        },
      },
      { status: 503 },
    );
  }

  const token = bearerFrom(request);
  if (!token) return unauthorized();

  const session = await authenticate(token);
  if (!session) return unauthorized();

  let body: RpcRequest;
  try {
    body = (await request.json()) as RpcRequest;
  } catch {
    return rpcError(null, PARSE_ERROR, 'Request body is not valid JSON.');
  }

  if (body?.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body?.id ?? null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request.');
  }

  const id = body.id ?? null;

  switch (body.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: brand.name.toLowerCase(), version: '1.0.0' },
        instructions: `${brand.name} is a marketplace for buying and selling businesses. You may read what this token’s owner can read and write drafts for them to review. You cannot send messages, issue confidentiality agreements, or publish anything — no such tool exists here, and a person must click send on anything that reaches another human being. Valuations and match scores are estimates for discussion, not advice; carry their disclaimers into anything you write.`,
      });

    // A notification: no id, no response expected.
    case 'notifications/initialized':
      return new Response(null, { status: 202 });

    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, {
        tools: toolsFor(session).map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: jsonSchemaFor(tool.name),
        })),
      });

    case 'tools/call':
      return callTool(id, session, body.params ?? {});

    default:
      return rpcError(id, METHOD_NOT_FOUND, `Unsupported method: ${body.method}`);
  }
}

async function callTool(
  id: string | number | null,
  session: McpSession,
  params: Record<string, unknown>,
): Promise<Response> {
  const name = typeof params.name === 'string' ? params.name : null;
  if (!name) return rpcError(id, INVALID_PARAMS, 'A tool name is required.');

  const tool = findTool(name);

  /*
   * A tool the token cannot use and a tool that does not exist give the same
   * answer. Otherwise this endpoint enumerates the full tool surface to any
   * valid token, including tools a narrower scope was chosen to exclude.
   */
  if (!tool || !toolsFor(session).includes(tool)) {
    return rpcError(id, METHOD_NOT_FOUND, `No tool named "${name}" is available to this token.`);
  }

  try {
    const output = await tool.run(session, params.arguments ?? {});
    return rpcResult(id, {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
      isError: false,
    });
  } catch (error) {
    /*
     * Tool failures come back as a result with isError, not as a JSON-RPC error:
     * the protocol reserves those for the call itself going wrong, and a model
     * that can read the message can often fix its own arguments and retry.
     */
    const message = error instanceof Error ? error.message : 'The tool failed.';
    return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
  }
}

/**
 * Hand-written JSON Schema per tool.
 *
 * Zod is the runtime validator and stays the single source of truth for what is
 * accepted; this is the advertised shape. Converting automatically would need
 * another dependency to describe six small objects, and a wrong conversion fails
 * as a confusing model error rather than a build break.
 */
function jsonSchemaFor(name: string): Record<string, unknown> {
  const object = (properties: Record<string, unknown>, required: string[] = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });

  const int = (description: string, extra: Record<string, unknown> = {}) => ({
    type: 'integer',
    description,
    ...extra,
  });

  switch (name) {
    case 'search_listings':
      return object({
        industry: { type: 'string', description: 'Industry key, e.g. home_services.' },
        state: { type: 'string', description: 'Jurisdiction code, e.g. US-NY.' },
        minEarningsCents: int('Minimum annual earnings, in cents.', { minimum: 0 }),
        maxAskingCents: int('Maximum asking price, in cents.', { minimum: 0 }),
        limit: int('How many to return, 1–50.', { minimum: 1, maximum: 50, default: 20 }),
      });

    case 'get_listing':
      return object({ listingId: { type: 'string', format: 'uuid' } }, ['listingId']);

    case 'list_matches':
    case 'list_tasks':
      return object({
        limit: int('How many to return.', { minimum: 1, maximum: 100, default: 20 }),
      });

    case 'run_valuation':
      return object(
        {
          industry: { type: 'string', description: 'Industry key, e.g. home_services.' },
          annualRevenueCents: int('Annual revenue, in cents.', { minimum: 0 }),
          annualEarningsCents: int('Annual earnings (SDE or EBITDA), in cents. May be negative.'),
          yearsInBusiness: int('Years trading.', { minimum: 0, maximum: 200 }),
        },
        ['industry', 'annualRevenueCents', 'annualEarningsCents'],
      );

    case 'draft_outreach':
      return object(
        {
          listingId: { type: 'string', format: 'uuid' },
          recipientId: { type: 'string', format: 'uuid', description: 'The buyer to address.' },
          subject: { type: 'string', maxLength: 300 },
          body: {
            type: 'string',
            minLength: 20,
            maxLength: 4000,
            description:
              'The draft. It is saved for a person to review and send — never sent here.',
          },
        },
        ['listingId', 'recipientId', 'body'],
      );

    default:
      return object({});
  }
}

/**
 * MCP clients probe with GET to discover whether a URL speaks the protocol.
 * Answering plainly beats a 405 that reads as a broken deployment.
 */
export function GET(): Response {
  return NextResponse.json(
    {
      name: brand.name.toLowerCase(),
      protocolVersion: PROTOCOL_VERSION,
      transport: 'streamable-http',
      configured: isMcpConfigured(),
      authentication: 'Bearer token, issued in the application under Settings.',
      note: 'Read and draft only. No tool on this server sends anything to another person.',
    },
    { status: 200 },
  );
}
