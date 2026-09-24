import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callAi, MODEL_FALLBACK_CHAIN } from '../aiClient';
import type { AiRequestParams } from '../aiClient';

function jsonResponse(body: unknown, init?: { status?: number }) {
  return {
    ok: (init?.status ?? 200) < 300,
    status: init?.status ?? 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function geminiRateLimitBody(retrySeconds: number) {
  return {
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: `${retrySeconds}s` }],
    },
  };
}

function geminiOkBody(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const baseParams: AiRequestParams = {
  provider: 'gemini',
  apiKey: 'test-key',
  model: MODEL_FALLBACK_CHAIN.gemini[0],
  systemPrompt: 'test',
  tools: [],
  messages: [{ role: 'user', text: 'hi' }],
};

describe('callAi model fallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately on success without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geminiOkBody('hello')));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAi(baseParams);
    expect(result.text).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries the same model on 429 before succeeding', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(geminiRateLimitBody(1), { status: 429 }))
      .mockResolvedValueOnce(jsonResponse(geminiOkBody('ok after retry')));
    vi.stubGlobal('fetch', fetchMock);

    const promise = callAi(baseParams);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.text).toBe('ok after retry');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both calls should have used the same (primary) model.
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain(MODEL_FALLBACK_CHAIN.gemini[0]);
    expect(firstBody).toBeTruthy();
  });

  it('falls through to the next model in the chain once retries on the first are exhausted', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes(MODEL_FALLBACK_CHAIN.gemini[0])) {
        return Promise.resolve(jsonResponse(geminiRateLimitBody(1), { status: 429 }));
      }
      return Promise.resolve(jsonResponse(geminiOkBody('fallback model answered')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = callAi(baseParams);
    // 2 retries on the primary model, each waiting ~1s per the mocked retryDelay.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.text).toBe('fallback model answered');
    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.filter(u => u.includes(MODEL_FALLBACK_CHAIN.gemini[0]))).toHaveLength(3); // 1 + 2 retries
    expect(urls.some(u => u.includes(MODEL_FALLBACK_CHAIN.gemini[1]))).toBe(true);
  });

  it('throws once every model in the chain is exhausted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geminiRateLimitBody(1), { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = callAi(baseParams).catch(err => err);
    // 3 attempts per model (1 + 2 retries) x 2 models in the gemini chain = 6 requests,
    // each preceded by a wait except the very first.
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1000);
    const err = await promise;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('429');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('does not retry or fall back on non-429 errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad request' } }, { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAi(baseParams)).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('starts the fallback chain from an unlisted model without dropping it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(geminiOkBody('custom model ok')));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAi({ ...baseParams, model: 'gemini-experimental-custom' });
    expect(result.text).toBe('custom model ok');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('gemini-experimental-custom');
  });

  it('tries the user-chosen fallbackModel before the built-in chain', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes(MODEL_FALLBACK_CHAIN.gemini[0])) {
        return Promise.resolve(jsonResponse(geminiRateLimitBody(1), { status: 429 }));
      }
      return Promise.resolve(jsonResponse(geminiOkBody('user fallback answered')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = callAi({ ...baseParams, fallbackModel: 'my-custom-fallback' });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.text).toBe('user fallback answered');
    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    // The user-chosen fallback should be tried right after the primary model, before the
    // provider's own built-in chain entry.
    expect(urls[3]).toContain('my-custom-fallback');
  });

  it('does not duplicate the user fallbackModel if it already appears in the built-in chain', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes(MODEL_FALLBACK_CHAIN.gemini[0])) {
        return Promise.resolve(jsonResponse(geminiRateLimitBody(1), { status: 429 }));
      }
      return Promise.resolve(jsonResponse(geminiOkBody('built-in fallback answered')));
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = callAi({ ...baseParams, fallbackModel: MODEL_FALLBACK_CHAIN.gemini[1] });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.text).toBe('built-in fallback answered');
    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.filter(u => u.includes(MODEL_FALLBACK_CHAIN.gemini[1]))).toHaveLength(1);
  });
});
