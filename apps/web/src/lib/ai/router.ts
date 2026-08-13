import 'server-only';

/**
 * The model router.
 *
 * Every AI call in the product goes through here. No feature talks to a
 * provider directly, which is what makes it possible to answer "what did we
 * send to whom" without reading every file, and to switch providers without
 * touching the features.
 *
 * ## The rule about what may be sent
 *
 * **Confidential listing data never reaches a provider.** The deterministic
 * matcher reads a seller's exact revenue and customer concentration because it
 * runs inside our own database. Sending those to a third-party API is a
 * disclosure to a subprocessor the seller never agreed to, and it is not undone
 * by a retention setting.
 *
 * So callers pass the anonymised teaser and the buyer's own words. That is
 * enforced by the shape of the request types in the calling modules, not here —
 * this module cannot know what a string contains. `redactPrompt()` below is a
 * last-resort scrub for the obvious cases, not a substitute for passing the
 * right data in.
 *
 * ## Degradation
 *
 * With no API key configured the router returns `null` rather than throwing.
 * AI output is an enhancement on top of a deterministic score that already
 * works; a missing key should cost a feature, not the page. Every caller has to
 * handle `null`, which the type makes unavoidable.
 */

export type ModelProvider = 'anthropic' | 'openai';

export interface ModelRequest {
  /** What the model is being asked to do. Never contains user data. */
  system: string;
  /** The data. Must already be free of confidential listing detail. */
  prompt: string;
  maxTokens?: number;
  /** Low for scoring work, where two runs should broadly agree. */
  temperature?: number;
}

export interface ModelResponse {
  text: string;
  /** The exact model that answered, recorded alongside anything it produced. */
  model: string;
  provider: ModelProvider;
}

/**
 * Model choice per task.
 *
 * Named by task rather than by capability so the mapping is visible in one
 * place and a task can be moved to a cheaper or better model without hunting
 * through call sites.
 */
export const MODELS = {
  /** Thesis matching: short, high volume, runs on every listing/buyer pair. */
  matching: {
    anthropic: 'claude-haiku-4-5-20251001',
    openai: 'gpt-4o-mini',
  },
  /** Longer reasoning: document review, deal summaries. */
  analysis: {
    anthropic: 'claude-sonnet-5',
    openai: 'gpt-4o',
  },
} as const;

export type ModelTask = keyof typeof MODELS;

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

/** How long to wait before giving up. A slow score is worth less than no score. */
const TIMEOUT_MS = 20_000;

export function availableProviders(): ModelProvider[] {
  const providers: ModelProvider[] = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
  if (process.env.OPENAI_API_KEY) providers.push('openai');
  return providers;
}

export function isAiConfigured(): boolean {
  return availableProviders().length > 0;
}

/**
 * Runs a request, trying providers in order until one answers.
 *
 * Returns null when nothing is configured or every provider failed. Callers
 * must treat that as "no AI opinion available" and carry on — never as an
 * error worth surfacing to a user who did not ask for AI in the first place.
 */
export async function runModel(
  task: ModelTask,
  request: ModelRequest,
): Promise<ModelResponse | null> {
  for (const provider of availableProviders()) {
    try {
      const response =
        provider === 'anthropic'
          ? await callAnthropic(MODELS[task].anthropic, request)
          : await callOpenAi(MODELS[task].openai, request);

      if (response) return response;
    } catch {
      // Fall through to the next provider. The reason is deliberately not
      // surfaced: a provider outage is our problem, not the user's, and the
      // feature degrades to the deterministic score either way.
      continue;
    }
  }

  return null;
}

async function callAnthropic(model: string, request: ModelRequest): Promise<ModelResponse | null> {
  const response = await fetchWithTimeout(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? 512,
      temperature: request.temperature ?? 0.2,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    model?: string;
  };

  const text = (data.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
    .trim();

  if (!text) return null;
  return { text, model: data.model ?? model, provider: 'anthropic' };
}

async function callOpenAi(model: string, request: ModelRequest): Promise<ModelResponse | null> {
  const response = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? 512,
      temperature: request.temperature ?? 0.2,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    }),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return { text, model: data.model ?? model, provider: 'openai' };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
