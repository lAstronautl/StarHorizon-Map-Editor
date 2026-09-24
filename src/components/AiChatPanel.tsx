import React, { useCallback, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import type { EditorState } from '../state/editorState';
import type { EditorAction } from '../state/actions';
import type { AiProvider } from '../ai/aiTypes';
import type { ChatMessage } from '../ai/aiTypes';
import { AiApiError } from '../ai/aiTypes';
import { DEFAULT_MODELS, MODEL_FALLBACK_CHAIN } from '../ai/aiClient';
import { runAgentTurn } from '../ai/agentRunner';
import { useT } from '../i18n';

interface Props {
  state: EditorState;
  dispatch: (action: EditorAction) => void;
  onClose: () => void;
}

interface DisplayStep {
  toolName: string;
  input: Record<string, unknown>;
  result: unknown;
  isError: boolean;
}

interface DisplayMessage {
  role: 'user' | 'assistant';
  text: string;
  steps?: DisplayStep[];
  /** Model that actually produced this message, shown only when it differs from what
   *  was requested (i.e. the fallback chain kicked in). */
  modelUsed?: string;
}

export const AiChatPanel: React.FC<Props> = ({ state, dispatch, onClose }) => {
  const { t } = useT();
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODELS.gemini);
  const [fallbackModel, setFallbackModel] = useState(MODEL_FALLBACK_CHAIN.gemini[1] ?? '');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const historyRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleProviderChange = useCallback((next: AiProvider) => {
    setProvider(next);
    setModel(DEFAULT_MODELS[next]);
    setFallbackModel(MODEL_FALLBACK_CHAIN[next][1] ?? '');
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    });
  }, []);

  const handleSend = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!apiKey.trim()) {
      setError(t('aiChatPanel.missingKey'));
      return;
    }
    setError(null);
    setPrompt('');
    setBusy(true);
    setMessages(prev => [...prev, { role: 'user', text }]);
    historyRef.current = [...historyRef.current, { role: 'user', text }];
    scrollToBottom();

    const steps: DisplayStep[] = [];
    try {
      const result = await runAgentTurn({
        provider,
        apiKey: apiKey.trim(),
        model,
        fallbackModel: fallbackModel.trim() || undefined,
        history: historyRef.current,
        toolCtx: { state, dispatch },
        onStep: (step) => {
          steps.push(step);
          scrollToBottom();
        },
      });
      // The full turn (including intermediate tool calls/results) becomes the new
      // history baseline, so the next turn has full context of what happened.
      historyRef.current = result.updatedHistory;
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: result.text,
        steps,
        modelUsed: result.modelUsed !== model ? result.modelUsed : undefined,
      }]);
    } catch (err) {
      if (err instanceof AiApiError && err.isRateLimit) {
        const wait = err.retryAfterSeconds ? ` (${t('aiChatPanel.retryIn', { seconds: err.retryAfterSeconds })})` : '';
        setError(t('aiChatPanel.rateLimited') + wait);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }, [prompt, busy, apiKey, provider, model, fallbackModel, state, dispatch, t, scrollToBottom]);

  const handleClear = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    setError(null);
  }, []);

  return (
    <div className="fixed top-0 right-0 bottom-0 z-[9997] w-[380px] max-w-[90vw] bg-surface border-l border-subtle flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-subtle shrink-0">
        <h2 className="text-sm font-semibold text-accent m-0">{t('aiChatPanel.title')}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            title={t('aiChatPanel.clearChat')}
            className="bg-transparent border-none text-muted hover:text-primary cursor-pointer text-xs px-1"
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
          <button
            onClick={onClose}
            title={t('aiChatPanel.close')}
            className="bg-transparent border-none text-muted hover:text-primary cursor-pointer text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 border-b border-subtle shrink-0 text-[11px]">
        <div className="flex items-center gap-2">
          <label className="text-muted w-16 shrink-0">{t('aiChatPanel.provider')}</label>
          <select
            value={provider}
            onChange={e => handleProviderChange(e.target.value as AiProvider)}
            className="flex-1 bg-elevated border border-subtle rounded text-primary text-[11px] px-1.5 py-1"
          >
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted w-16 shrink-0">{t('aiChatPanel.model')}</label>
          <input
            value={model}
            onChange={e => setModel(e.target.value)}
            className="flex-1 bg-elevated border border-subtle rounded text-primary text-[11px] px-1.5 py-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted w-16 shrink-0">{t('aiChatPanel.fallbackModel')}</label>
          <input
            value={fallbackModel}
            onChange={e => setFallbackModel(e.target.value)}
            placeholder={t('aiChatPanel.fallbackModelPlaceholder')}
            className="flex-1 bg-elevated border border-subtle rounded text-primary text-[11px] px-1.5 py-1"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted w-16 shrink-0">{t('aiChatPanel.apiKey')}</label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={t('aiChatPanel.apiKeyPlaceholder')}
            className="flex-1 bg-elevated border border-subtle rounded text-primary text-[11px] px-1.5 py-1"
            autoComplete="off"
          />
        </div>
        <div className="text-muted text-[10px] leading-snug">{t('aiChatPanel.apiKeyHint')}</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-muted text-[12px] text-center mt-6">{t('aiChatPanel.emptyState')}</div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className={`text-[10px] font-semibold ${m.role === 'user' ? 'text-accent' : 'text-success'}`}>
              {m.role === 'user' ? 'You' : 'AI'}
            </div>
            {m.text && (
              <div className="text-[12px] text-primary whitespace-pre-wrap leading-snug">{m.text}</div>
            )}
            {m.modelUsed && (
              <div className="text-muted text-[10px] italic">{t('aiChatPanel.fallbackUsed', { model: m.modelUsed })}</div>
            )}
            {m.steps && m.steps.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {m.steps.map((s, si) => (
                  <details key={si} className="bg-elevated border border-subtle rounded px-2 py-1">
                    <summary className={`text-[10px] cursor-pointer ${s.isError ? 'text-danger' : 'text-muted'}`}>
                      {t('aiChatPanel.toolCall')}: {s.toolName}
                    </summary>
                    <pre className="text-[10px] text-muted whitespace-pre-wrap break-words mt-1 mb-0">
                      {JSON.stringify(s.input, null, 2)}
                      {'\n→ '}
                      {JSON.stringify(s.result, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="text-muted text-[11px] italic">{t('aiChatPanel.thinking')}</div>}
        {error && <div className="text-danger text-[11px]">{t('aiChatPanel.error')}: {error}</div>}
      </div>

      <div className="flex items-end gap-2 px-3 py-2 border-t border-subtle shrink-0">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={t('aiChatPanel.promptPlaceholder')}
          rows={2}
          className="flex-1 bg-elevated border border-subtle rounded text-primary text-[12px] px-2 py-1.5 resize-none outline-none"
        />
        <button
          onClick={() => void handleSend()}
          disabled={busy || !prompt.trim()}
          className="bg-active border border-subtle rounded text-primary text-[12px] px-3 py-1.5 cursor-pointer hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {t('aiChatPanel.send')}
        </button>
      </div>
    </div>
  );
};
