// src/ai/aiTypes.ts
/** Provider-agnostic types for the AI agent chat. */

export type AiProvider = 'gemini' | 'claude';

/** JSON Schema (subset) describing a tool's input, shared by both providers. */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** Provider-specific opaque data that must be echoed back verbatim on the next
   *  request (e.g. Gemini's `thoughtSignature` on function-call parts — required
   *  for "thinking" models, omitting it causes a 400 INVALID_ARGUMENT). */
  providerMeta?: unknown;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  /** Result content returned to the model — must be JSON-serializable. */
  result: unknown;
  isError?: boolean;
}

export type ChatRole = 'user' | 'assistant';

/** A single turn in the conversation, as shown in the chat UI and replayed to the model. */
export interface ChatMessage {
  role: ChatRole;
  /** Plain text content (assistant's reasoning/response, or the user's prompt). */
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** Provider-specific raw response parts (currently: Gemini's `parts` array, verbatim),
   *  replayed as-is on the next request instead of being reconstructed from text/toolCalls.
   *  Needed because "thinking" models require exact part order/signatures to be echoed back. */
  providerRawParts?: unknown[];
}

export interface AgentTurnResult {
  /** Final assistant text for this turn (after all tool calls resolved), if any. */
  text: string;
  /** Every tool call made and its result, in order, across all round-trips this turn. */
  steps: { call: ToolCall; result: ToolResult }[];
}

export class AiApiError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    /** True for HTTP 429 (quota/rate limit exceeded). */
    public readonly isRateLimit: boolean = false,
    /** Seconds the provider says to wait before retrying, if it told us. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AiApiError';
  }
}
