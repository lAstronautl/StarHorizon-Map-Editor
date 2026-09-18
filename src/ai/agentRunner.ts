// src/ai/agentRunner.ts
/**
 * Drives one user turn of the agent loop: call the model, execute any tool
 * calls it makes against the live editor state, feed results back, and repeat
 * until the model responds with plain text (or a safety cap is hit).
 */
import type { AiProvider, AgentTurnResult, ChatMessage, ToolResult } from './aiTypes';
import { callAi } from './aiClient';
import { getToolDefinitions, executeAgentTool, type AgentToolContext } from './agentTools';

// Safety cap against a runaway tool-calling loop, not a normal stopping point — the model is
// expected to finish on its own (a plain-text response with no tool calls) well before this.
// Rate limits mid-turn are handled per-request inside callAi (wait + retry, then fall back to
// another model), so they don't count against this and don't need a round of their own.
const MAX_TOOL_ROUNDS = 7;

const SYSTEM_PROMPT = `You are an assistant embedded in a Space Station 14 map editor. You can inspect and modify the current map by calling the provided tools (placing/removing entities, painting tiles, drawing pipes/cables, running the map validator). Coordinates are integer tile positions; the tools take care of centering entities and auto-fitting pipe shapes.

Guidelines:
- Prefer batch tools (place_entities, paint_tiles, draw_pipe, draw_cable) over many single calls.
- Before big destructive changes (removing many entities), briefly explain what you're about to do in your text response.
- After making significant structural changes, consider calling validate_map to check your work and mention any issues found.
- Use get_map_info to check what's already there before placing things, especially when asked to "add" something without exact coordinates.
- Keep your text responses concise — describe what you did/plan to do, not a restatement of the tool schemas.
- All prototype IDs must be real SS14 entity/tile prototype IDs (e.g. "AirlockGlass", "FloorSteel", "GasVentPump", "TableSteel"). If unsure of an exact ID, make a reasonable best guess based on common SS14 naming conventions.`;

export interface RunAgentTurnParams {
  provider: AiProvider;
  apiKey: string;
  model: string;
  history: ChatMessage[];
  toolCtx: AgentToolContext;
  onStep?: (step: { toolName: string; input: Record<string, unknown>; result: unknown; isError: boolean }) => void;
}

export interface AgentTurnRunResult extends AgentTurnResult {
  /** Full message history after this turn, including intermediate tool calls/results —
   *  feed this back in as `history` for the next call so the model keeps full context. */
  updatedHistory: ChatMessage[];
  /** The model that produced the final response (may differ from the requested model if
   *  callAi fell back to a later entry in its chain due to rate limits mid-turn). */
  modelUsed: string;
}

export async function runAgentTurn(params: RunAgentTurnParams): Promise<AgentTurnRunResult> {
  const messages: ChatMessage[] = [...params.history];
  const tools = getToolDefinitions();
  const steps: AgentTurnResult['steps'] = [];
  let modelUsed = params.model;
  let lastText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callAi({
      provider: params.provider,
      apiKey: params.apiKey,
      model: params.model,
      systemPrompt: SYSTEM_PROMPT,
      tools,
      messages,
    });
    modelUsed = response.modelUsed;
    if (response.text) lastText = response.text;

    if (response.toolCalls.length === 0) {
      messages.push({ role: 'assistant', text: response.text || undefined, providerRawParts: response.providerRawParts });
      return { text: response.text, steps, updatedHistory: messages, modelUsed };
    }

    messages.push({
      role: 'assistant',
      text: response.text || undefined,
      toolCalls: response.toolCalls,
      providerRawParts: response.providerRawParts,
    });

    const toolResults: ToolResult[] = [];
    for (const call of response.toolCalls) {
      let result: unknown;
      let isError = false;
      try {
        result = executeAgentTool(call.name, call.input, params.toolCtx);
      } catch (err) {
        isError = true;
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      toolResults.push({ toolCallId: call.id, name: call.name, result, isError });
      steps.push({ call, result: { toolCallId: call.id, name: call.name, result, isError } });
      params.onStep?.({ toolName: call.name, input: call.input, result, isError });
    }

    messages.push({ role: 'user', toolResults });
  }

  // Hit the safety cap without the model finishing on its own. Surface whatever text it
  // last produced (if any) rather than an alarming "stopped" message — the tool calls it
  // already made are still visible in the step list, and the user can just ask it to continue.
  return {
    text: lastText,
    steps,
    updatedHistory: messages,
    modelUsed,
  };
}
