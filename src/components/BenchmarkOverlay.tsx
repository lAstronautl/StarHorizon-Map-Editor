import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  isBenchmarkCapturing,
  startBenchmark,
  stopBenchmark,
  getBenchmarkRemaining,
} from '../rendering/benchmarkCapture';
import type { BenchmarkResult } from '../rendering/benchmarkCapture';

export const BenchmarkOverlay: React.FC = () => {
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
        {capturing ? `⏹ Стоп (${remaining}с)` : '▶ Бенчмарк (15с)'}
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
          ● Запись... осталось {remaining}с
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
            Результаты бенчмарка
          </div>

          <Section title="Время">
            <Row label="Длительность" value={`${(result.durationMs / 1000).toFixed(1)}с`} />
            <Row label="Всего кадров" value={String(result.totalFrames)} />
            <Row label="Отрисовано" value={String(result.renderedFrames)} />
            <Row label="Пропущено (простой)" value={String(result.skippedFrames)} />
          </Section>

          <Section title="FPS">
            <Row label="Среднее" value={String(result.avgFps)} color={fpsColor(result.avgFps)} />
            <Row label="1% минимум" value={String(result.p1Fps)} color={fpsColor(result.p1Fps)} />
            <Row label="Минимум" value={String(result.minFps)} color={fpsColor(result.minFps)} />
          </Section>

          <Section title="Время кадра (отрисованные)">
            <Row label="Среднее" value={`${result.avgFrameTime} мс`} color={ftColor(result.avgFrameTime)} />
            <Row label="Медиана" value={`${result.medianFrameTime} мс`} />
            <Row label="P95" value={`${result.p95FrameTime} мс`} color={ftColor(result.p95FrameTime)} />
            <Row label="P99" value={`${result.p99FrameTime} мс`} color={ftColor(result.p99FrameTime)} />
            <Row label="Макс." value={`${result.maxFrameTime} мс`} color={ftColor(result.maxFrameTime)} />
          </Section>

          <Section title="Вызовы отрисовки">
            <Row label="Среднее" value={String(result.avgDrawCalls)} />
            <Row label="Макс." value={String(result.maxDrawCalls)} />
          </Section>

          <Section title="Сцена">
            <Row label="Всего сущностей" value={result.totalEntities.toLocaleString()} />
            <Row label="Ср. видимых" value={result.avgVisibleEntities.toLocaleString()} />
            <Row label="Масштаб" value={`${result.zoom}x`} />
            <Row label="пикс/тайл" value={String(result.pxPerTile)} />
          </Section>

          <Section title="Эффективность кэша">
            <Row
              label="Перерисовка тайлов"
              value={`${result.tileRedrawRate}%`}
              color={result.tileRedrawRate < 20 ? '#4caf50' : result.tileRedrawRate < 50 ? '#ff9800' : '#f44336'}
            />
            <Row
              label="Перерисовка сущностей"
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
              Скопировать в буфер
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
              Скрыть
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
    `=== Результаты бенчмарка ===`,
    `Дата: ${r.startTime}`,
    `Длительность: ${(r.durationMs / 1000).toFixed(1)}с`,
    ``,
    `--- FPS ---`,
    `Среднее: ${r.avgFps}`,
    `1% минимум: ${r.p1Fps}`,
    `Минимум: ${r.minFps}`,
    ``,
    `--- Время кадра ---`,
    `Среднее: ${r.avgFrameTime} мс`,
    `Медиана: ${r.medianFrameTime} мс`,
    `P95:     ${r.p95FrameTime} мс`,
    `P99:     ${r.p99FrameTime} мс`,
    `Макс.:   ${r.maxFrameTime} мс`,
    ``,
    `--- Сцена ---`,
    `Всего сущностей: ${r.totalEntities}`,
    `Ср. видимых:     ${r.avgVisibleEntities}`,
    `Масштаб: ${r.zoom}x (${r.pxPerTile} пикс/тайл)`,
    ``,
    `--- Кадры ---`,
    `Всего:      ${r.totalFrames}`,
    `Отрисовано: ${r.renderedFrames}`,
    `Пропущено:  ${r.skippedFrames}`,
    ``,
    `--- Эффективность кэша ---`,
    `Перерисовка тайлов:    ${r.tileRedrawRate}%`,
    `Перерисовка сущностей: ${r.entityRedrawRate}%`,
    `Вызовы отрисовки: ср. ${r.avgDrawCalls}, макс. ${r.maxDrawCalls}`,
  ].join('\n');
}
