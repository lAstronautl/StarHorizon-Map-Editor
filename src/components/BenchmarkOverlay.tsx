import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  isBenchmarkCapturing,
  startBenchmark,
  stopBenchmark,
  getBenchmarkRemaining,
} from '../rendering/benchmarkCapture';
import type { BenchmarkResult } from '../rendering/benchmarkCapture';
import { t, useT } from '../i18n';

export const BenchmarkOverlay: React.FC = () => {
  const { t } = useT();
  const [capturing, setCapturing] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [remaining, setRemaining] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up countdown interval on unmount
  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, []);

  const finishCapture = useCallback(() => {
    const r = stopBenchmark();
    setResult(r);
    setCapturing(false);
    setRemaining(0);
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  const handleToggle = useCallback(() => {
    if (isBenchmarkCapturing()) {
      finishCapture();
    } else {
      setResult(null);
      startBenchmark(() => finishCapture());
      setCapturing(true);
      setRemaining(15);
      // Update countdown every second
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        const r = getBenchmarkRemaining();
        setRemaining(r);
      }, 200);
    }
  }, [finishCapture]);

  const handleCopy = useCallback(() => {
    if (!result) return;
    const text = formatResultText(result);
    navigator.clipboard.writeText(text);
  }, [result]);

  return (
    <div style={{
      position: 'absolute',
      top: 44,
      right: 8,
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 6,
      pointerEvents: 'auto',
    }}>
      {/* Start / Stop button */}
      <button
        onClick={handleToggle}
        style={{
          padding: '6px 16px',
          fontSize: 12,
          fontFamily: 'monospace',
          fontWeight: 'bold',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          color: '#fff',
          backgroundColor: capturing ? '#c62828' : '#2e7d32',
          boxShadow: capturing
            ? '0 0 12px rgba(198, 40, 40, 0.6)'
            : '0 0 8px rgba(46, 125, 50, 0.4)',
        }}
      >
        {capturing ? t('benchmarkOverlay.stop', { seconds: remaining }) : t('benchmarkOverlay.start')}
      </button>

      {/* Recording indicator */}
      {capturing && (
        <div style={{
          padding: '4px 10px',
          fontSize: 11,
          fontFamily: 'monospace',
          backgroundColor: 'rgba(198, 40, 40, 0.85)',
          color: '#fff',
          borderRadius: 4,
          animation: 'benchPulse 1.5s ease-in-out infinite',
        }}>
          {t('benchmarkOverlay.recording', { seconds: remaining })}
        </div>
      )}

      {/* Results panel */}
      {result && !capturing && (
        <div style={{
          backgroundColor: 'rgba(0, 0, 0, 0.88)',
          color: '#ccc',
          padding: '10px 14px',
          borderRadius: 6,
          fontSize: 11,
          fontFamily: 'monospace',
          lineHeight: 1.7,
          minWidth: 260,
          maxWidth: 320,
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          <div style={{ color: '#90caf9', fontWeight: 'bold', marginBottom: 4, fontSize: 12 }}>
            {t('benchmarkOverlay.results.title')}
          </div>

          <Section title={t('benchmarkOverlay.results.timing')}>
            <Row label={t('benchmarkOverlay.results.duration')} value={`${(result.durationMs / 1000).toFixed(1)}${t('benchmarkOverlay.unit.seconds')}`} />
            <Row label={t('benchmarkOverlay.results.totalFrames')} value={String(result.totalFrames)} />
            <Row label={t('benchmarkOverlay.results.rendered')} value={String(result.renderedFrames)} />
            <Row label={t('benchmarkOverlay.results.skippedIdle')} value={String(result.skippedFrames)} />
          </Section>

          <Section title="FPS">
            <Row label={t('benchmarkOverlay.results.average')} value={String(result.avgFps)} color={fpsColor(result.avgFps)} />
            <Row label={t('benchmarkOverlay.results.p1Low')} value={String(result.p1Fps)} color={fpsColor(result.p1Fps)} />
            <Row label={t('benchmarkOverlay.results.minimum')} value={String(result.minFps)} color={fpsColor(result.minFps)} />
          </Section>

          <Section title={t('benchmarkOverlay.results.frameTimeRendered')}>
            <Row label={t('benchmarkOverlay.results.average')} value={`${result.avgFrameTime} ${t('benchmarkOverlay.unit.ms')}`} color={ftColor(result.avgFrameTime)} />
            <Row label={t('benchmarkOverlay.results.median')} value={`${result.medianFrameTime} ${t('benchmarkOverlay.unit.ms')}`} />
            <Row label="P95" value={`${result.p95FrameTime} ${t('benchmarkOverlay.unit.ms')}`} color={ftColor(result.p95FrameTime)} />
            <Row label="P99" value={`${result.p99FrameTime} ${t('benchmarkOverlay.unit.ms')}`} color={ftColor(result.p99FrameTime)} />
            <Row label={t('benchmarkOverlay.results.max')} value={`${result.maxFrameTime} ${t('benchmarkOverlay.unit.ms')}`} color={ftColor(result.maxFrameTime)} />
          </Section>

          <Section title={t('benchmarkOverlay.results.drawCalls')}>
            <Row label={t('benchmarkOverlay.results.average')} value={String(result.avgDrawCalls)} />
            <Row label={t('benchmarkOverlay.results.max')} value={String(result.maxDrawCalls)} />
          </Section>

          <Section title={t('benchmarkOverlay.results.scene')}>
            <Row label={t('benchmarkOverlay.results.totalEntities')} value={result.totalEntities.toLocaleString()} />
            <Row label={t('benchmarkOverlay.results.avgVisible')} value={result.avgVisibleEntities.toLocaleString()} />
            <Row label={t('benchmarkOverlay.results.zoom')} value={`${result.zoom}x`} />
            <Row label={t('benchmarkOverlay.results.pxPerTile')} value={String(result.pxPerTile)} />
          </Section>

          <Section title={t('benchmarkOverlay.results.cacheEfficiency')}>
            <Row
              label={t('benchmarkOverlay.results.tileRedraws')}
              value={`${result.tileRedrawRate}%`}
              color={result.tileRedrawRate < 20 ? '#4caf50' : result.tileRedrawRate < 50 ? '#ff9800' : '#f44336'}
            />
            <Row
              label={t('benchmarkOverlay.results.entityRedraws')}
              value={`${result.entityRedrawRate}%`}
              color={result.entityRedrawRate < 20 ? '#4caf50' : result.entityRedrawRate < 50 ? '#ff9800' : '#f44336'}
            />
          </Section>

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              onClick={handleCopy}
              style={{
                flex: 1,
                padding: '4px 8px',
                fontSize: 10,
                fontFamily: 'monospace',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 3,
                cursor: 'pointer',
                color: '#ccc',
                backgroundColor: 'rgba(255,255,255,0.08)',
              }}
            >
              {t('benchmarkOverlay.copyToClipboard')}
            </button>
            <button
              onClick={() => setResult(null)}
              style={{
                padding: '4px 8px',
                fontSize: 10,
                fontFamily: 'monospace',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 3,
                cursor: 'pointer',
                color: '#888',
                backgroundColor: 'rgba(255,255,255,0.05)',
              }}
            >
              {t('benchmarkOverlay.dismiss')}
            </button>
          </div>
        </div>
      )}

      {/* Pulse animation for recording indicator */}
      <style>{`
        @keyframes benchPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ color: '#666', fontWeight: 'bold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: color ?? '#e0e0e0' }}>{value}</span>
    </div>
  );
}

function fpsColor(fps: number): string {
  if (fps >= 55) return '#4caf50';
  if (fps >= 30) return '#ff9800';
  return '#f44336';
}

function ftColor(ms: number): string {
  if (ms <= 8) return '#4caf50';
  if (ms <= 16) return '#ff9800';
  return '#f44336';
}

function formatResultText(r: BenchmarkResult): string {
  return [
    `=== ${t('benchmarkOverlay.results.title')} ===`,
    `${t('benchmarkOverlay.text.date')}: ${r.startTime}`,
    `${t('benchmarkOverlay.results.duration')}: ${(r.durationMs / 1000).toFixed(1)}${t('benchmarkOverlay.unit.seconds')}`,
    ``,
    `--- FPS ---`,
    `${t('benchmarkOverlay.results.average')}: ${r.avgFps}`,
    `${t('benchmarkOverlay.results.p1Low')}:  ${r.p1Fps}`,
    `${t('benchmarkOverlay.results.minimum')}: ${r.minFps}`,
    ``,
    `--- ${t('benchmarkOverlay.text.frameTime')} ---`,
    `${t('benchmarkOverlay.results.average')}: ${r.avgFrameTime} ${t('benchmarkOverlay.unit.ms')}`,
    `${t('benchmarkOverlay.results.median')}: ${r.medianFrameTime} ${t('benchmarkOverlay.unit.ms')}`,
    `P95:     ${r.p95FrameTime} ${t('benchmarkOverlay.unit.ms')}`,
    `P99:     ${r.p99FrameTime} ${t('benchmarkOverlay.unit.ms')}`,
    `${t('benchmarkOverlay.results.max')}:   ${r.maxFrameTime} ${t('benchmarkOverlay.unit.ms')}`,
    ``,
    `--- ${t('benchmarkOverlay.results.scene')} ---`,
    `${t('benchmarkOverlay.results.totalEntities')}: ${r.totalEntities}`,
    `${t('benchmarkOverlay.results.avgVisible')}:     ${r.avgVisibleEntities}`,
    `${t('benchmarkOverlay.results.zoom')}: ${r.zoom}x (${r.pxPerTile} ${t('benchmarkOverlay.results.pxPerTile')})`,
    ``,
    `--- ${t('benchmarkOverlay.text.frames')} ---`,
    `${t('benchmarkOverlay.results.totalFrames')}:      ${r.totalFrames}`,
    `${t('benchmarkOverlay.results.rendered')}: ${r.renderedFrames}`,
    `${t('benchmarkOverlay.text.skipped')}:  ${r.skippedFrames}`,
    ``,
    `--- ${t('benchmarkOverlay.results.cacheEfficiency')} ---`,
    `${t('benchmarkOverlay.results.tileRedraws')}:    ${r.tileRedrawRate}%`,
    `${t('benchmarkOverlay.results.entityRedraws')}: ${r.entityRedrawRate}%`,
    `${t('benchmarkOverlay.text.drawCalls')}: ${t('benchmarkOverlay.text.avgAbbr')} ${r.avgDrawCalls}, ${t('benchmarkOverlay.text.maxAbbr')} ${r.maxDrawCalls}`,
  ].join('\n');
}
