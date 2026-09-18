import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiResponse } from '../aiClient';
import type { ToolCall } from '../aiTypes';

const callAiMock = vi.fn<(...args: unknown[]) => Promise<AiResponse>>();
vi.mock('../aiClient', () => ({
  callAi: (...args: unknown[]) => callAiMock(...args),
}));

// Imported after the mock so agentRunner picks up the mocked callAi.
const { runAgentTurn } = await import('../agentRunner');

function textResponse(text: string, modelUsed = 'gemini-3.5-flash-lite'): AiResponse {
  return { text, toolCalls: [], modelUsed };
}

function toolCallResponse(calls: ToolCall[], modelUsed = 'gemini-3.5-flash-lite'): AiResponse {
  return { text: '', toolCalls: calls, modelUsed };
}

const baseParams = {
  provider: 'gemini' as const,
  apiKey: 'k',
  model: 'gemini-3.5-flash-lite',
  history: [],
  toolCtx: { state: {} as never, dispatch: vi.fn() },
};

describe('runAgentTurn', () => {
  beforeEach(() => {
    callAiMock.mockReset();
  });

  it('returns immediately when the model responds with plain text (no tool calls)', async () => {
    callAiMock.mockResolvedValue(textResponse('Hello there'));
    const result = await runAgentTurn(baseParams);
    expect(result.text).toBe('Hello there');
    expect(result.steps).toHaveLength(0);
    expect(callAiMock).toHaveBeenCalledTimes(1);
  });

  it('executes tool calls and feeds results back for another round', async () => {
    callAiMock
      .mockResolvedValueOnce(toolCallResponse([{ id: 'c1', name: 'get_map_info', input: {} }]))
      .mockResolvedValueOnce(textResponse('Done, the map has 0 entities.'));

    const result = await runAgentTurn(baseParams);
    expect(result.text).toBe('Done, the map has 0 entities.');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].call.name).toBe('get_map_info');
    expect(callAiMock).toHaveBeenCalledTimes(2);
  });

  it('reports modelUsed from the final response, even if a fallback model answered', async () => {
    callAiMock.mockResolvedValue(textResponse('ok', 'gemini-3.1-flash-lite'));
    const result = await runAgentTurn(baseParams);
    expect(result.modelUsed).toBe('gemini-3.1-flash-lite');
  });

  it('surfaces the last text produced instead of an alarming message when the round cap is hit', async () => {
    // The model calls tools every round and never stops on its own — should hit the
    // safety cap after 7 rounds, but the final result should carry whatever text (if any)
    // came with the last tool-calling response, not a "stopped" placeholder.
    callAiMock.mockImplementation(() => Promise.resolve(
      toolCallResponse([{ id: 'c', name: 'get_map_info', input: {} }]),
    ));
    // Make the very last mocked call include some text alongside its tool call.
    callAiMock.mockImplementation((() => {
      let calls = 0;
      return () => {
        calls++;
        const withText = calls === 7 ? 'Still working on it...' : '';
        return Promise.resolve({
          text: withText,
          toolCalls: [{ id: `c${calls}`, name: 'get_map_info', input: {} }],
          modelUsed: 'gemini-3.5-flash-lite',
        });
      };
    })());

    const result = await runAgentTurn(baseParams);
    expect(result.text).toBe('Still working on it...');
    expect(result.text).not.toMatch(/stopped|maximum/i);
    expect(callAiMock).toHaveBeenCalledTimes(7);
  });

  it('keeps intermediate tool calls/results in updatedHistory for the next turn', async () => {
    callAiMock
      .mockResolvedValueOnce(toolCallResponse([{ id: 'c1', name: 'get_map_info', input: {} }]))
      .mockResolvedValueOnce(textResponse('summary'));

    const result = await runAgentTurn(baseParams);
    const roles = result.updatedHistory.map(m => m.role);
    expect(roles).toEqual(['assistant', 'user', 'assistant']);
    expect(result.updatedHistory[0].toolCalls?.[0].name).toBe('get_map_info');
    expect(result.updatedHistory[1].toolResults?.[0].name).toBe('get_map_info');
  });
});
