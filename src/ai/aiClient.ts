// src/ai/aiClient.ts
/**
 * Minimal browser-side clients for Gemini and Claude with tool-calling support.
 * No backend — requests go straight from the browser to the provider's REST API
 * using the user-supplied API key. The key is only ever held in memory (never
 * persisted) by the caller (AiChatPanel).
 */
import type { AiProvider, ChatMessage, ToolCall, ToolDefinition, ToolResult } from './aiTypes';
import { AiApiError } from './aiTypes';

export interface AiRequestParams {
  provider: AiProvider;
  apiKey: string;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  messages: ChatMessage[];
}

/** What an individual provider call (callGemini/callClaude) returns, before callAi
 *  stamps on which model actually produced it. */
interface RawAiResponse {
  text: string;
  toolCalls: ToolCall[];
  /** Provider-specific raw response parts, to be stored on the resulting ChatMessage and
   *  replayed verbatim on the next request (see ChatMessage.providerRawParts). */
  providerRawParts?: unknown[];
}

export interface AiResponse extends RawAiResponse {
  /** The model that actually produced this response — may differ from the requested
   *  model if callAi fell back to a later entry in MODEL_FALLBACK_CHAIN. */
  modelUsed: string;
}

const MAX_RATE_LIMIT_RETRIES = 2;

/** Models to try in order for each provider when the primary one is rate-limited.
 *  Only the first entry is used as the UI default; the rest are silent fallbacks. */
export const MODEL_FALLBACK_CHAIN: Record<AiProvider, string[]> = {
  gemini: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
  claude: ['claude-sonnet-4-5-20250929'],
};

/** Retries once or twice on 429s per model, waiting for the delay the provider tells us to
 *  (capped); once a model exhausts its retries, falls through to the next model in that
 *  provider's fallback chain (starting from whichever model the caller requested) before
 *  finally giving up. Free-tier quotas are tight enough that both routinely help mid-chat. */
export async function callAi(params: AiRequestParams): Promise<AiResponse> {
  const call = params.provider === 'gemini' ? callGemini : callClaude;
  const chain = MODEL_FALLBACK_CHAIN[params.provider];
  const startIdx = chain.indexOf(params.model);
  const modelsToTry = startIdx >= 0 ? chain.slice(startIdx) : [params.model, ...chain];

  let lastErr: unknown;
  for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
    const model = modelsToTry[modelIdx];
    const isLastModel = modelIdx === modelsToTry.length - 1;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        const response = await call({ ...params, model });
        return { ...response, modelUsed: model };
      } catch (err) {
        lastErr = err;
        if (!(err instanceof AiApiError) || !err.isRateLimit) throw err;
        if (attempt < MAX_RATE_LIMIT_RETRIES) {
          const waitSeconds = Math.min(err.retryAfterSeconds ?? 5 * (attempt + 1), 30);
          await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        } else if (isLastModel) {
          throw err;
        }
        // Retries on this model exhausted but another model remains — fall through to it.
      }
    }
  }
  throw lastErr;
}

// ---- Claude (Anthropic Messages API) ----

function toClaudeTools(tools: ToolDefinition[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

function toClaudeMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === 'user' && m.toolResults?.length) {
      out.push({
        role: 'user',
        content: m.toolResults.map(r => ({
          type: 'tool_result',
          tool_use_id: r.toolCallId,
          content: JSON.stringify(r.result),
          is_error: r.isError ?? false,
        })),
      });
      continue;
    }
    const content: unknown[] = [];
    if (m.text) content.push({ type: 'text', text: m.text });
    if (m.toolCalls?.length) {
      for (const call of m.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
    }
    out.push({ role: m.role, content });
  }
  return out;
}

async function callClaude(params: AiRequestParams): Promise<RawAiResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      tools: toClaudeTools(params.tools),
      messages: toClaudeMessages(params.messages),
    }),
  }).catch(err => { throw new AiApiError('Network error calling Claude API', err); });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
      throw new AiApiError(`Claude API error 429: rate limit exceeded. ${body.slice(0, 300)}`, undefined, true, retryAfterSeconds);
    }
    throw new AiApiError(`Claude API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
  };

  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const block of data.content ?? []) {
    if (block.type === 'text' && block.text) text += block.text;
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
    }
  }
  return { text, toolCalls };
}

// ---- Gemini (Generative Language API) ----

function toGeminiSchema(schema: ToolDefinition['parameters']): unknown {
  // Gemini's function declaration schema is a near-subset of JSON Schema; pass through as-is.
  return schema;
}

function toGeminiTools(tools: ToolDefinition[]) {
  if (tools.length === 0) return undefined;
  return [{
    functionDeclarations: tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: toGeminiSchema(t.parameters),
    })),
  }];
}

function toGeminiContents(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.toolResults?.length) {
      out.push({
        role: 'user',
        parts: m.toolResults.map(r => ({
          functionResponse: { name: r.name, response: { result: r.result } },
        })),
      });
      continue;
    }
    // Assistant turns that came from Gemini carry the exact `parts` the API returned
    // (including any `thoughtSignature` on function-call parts) — replay those verbatim
    // instead of reconstructing them, since "thinking" models require the signature to
    // be echoed back or they reject the next request with a 400.
    if (m.role === 'assistant' && m.providerRawParts) {
      out.push({ role: 'model', parts: m.providerRawParts });
      continue;
    }
    const parts: unknown[] = [];
    if (m.text) parts.push({ text: m.text });
    if (m.toolCalls?.length) {
      for (const call of m.toolCalls) {
        const part: Record<string, unknown> = { functionCall: { name: call.name, args: call.input } };
        if (call.providerMeta) part.thoughtSignature = call.providerMeta;
        parts.push(part);
      }
    }
    out.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  return out;
}

async function callGemini(params: AiRequestParams): Promise<RawAiResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      tools: toGeminiTools(params.tools),
      contents: toGeminiContents(params.messages),
    }),
  }).catch(err => { throw new AiApiError('Network error calling Gemini API', err); });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 429) {
      // Gemini embeds the suggested wait as a RetryInfo detail, e.g.
      // { "@type": ".../google.rpc.RetryInfo", "retryDelay": "56s" }.
      let retryAfterSeconds: number | undefined;
      try {
        const parsed = JSON.parse(body) as { error?: { details?: Array<{ '@type'?: string; retryDelay?: string }> } };
        const retryInfo = parsed.error?.details?.find(d => d['@type']?.includes('RetryInfo'));
        const match = retryInfo?.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
        if (match) retryAfterSeconds = Math.ceil(parseFloat(match[1]));
      } catch { /* fall through with no parsed delay */ }
      throw new AiApiError(`Gemini API error 429: quota exceeded. ${body.slice(0, 300)}`, undefined, true, retryAfterSeconds);
    }
    throw new AiApiError(`Gemini API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> }; thoughtSignature?: unknown }> } }>;
  };

  let text = '';
  const toolCalls: ToolCall[] = [];
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  let callIndex = 0;
  for (const part of parts) {
    if (part.text) text += part.text;
    if (part.functionCall) {
      toolCalls.push({
        id: `gemini-call-${callIndex++}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
        providerMeta: part.thoughtSignature,
      });
    }
  }
  return { text, toolCalls, providerRawParts: parts.length > 0 ? parts : undefined };
}

// ---- Default models ----

/** UI default per provider: the first (primary) model in that provider's fallback chain. */
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: MODEL_FALLBACK_CHAIN.gemini[0],
  claude: MODEL_FALLBACK_CHAIN.claude[0],
};
