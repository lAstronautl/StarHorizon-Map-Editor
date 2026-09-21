import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  HttpResourceProvider,
  FileSystemResourceProvider,
  setActiveProvider,
} from '../loaders/resourceProvider';
import type { ResourceProvider } from '../loaders/resourceProvider';
import {
  buildFileMapFromFileList,
  buildFileMapFromDirectoryHandle,
  validateRepository,
  summarizeRepository,
} from '../loaders/directoryScanner';
import type { RepositorySummary } from '../loaders/directoryScanner';
import { BASE_URL, withBase } from '../basePath';
import { useT } from '../i18n';
import type { UseMultiplayerResult } from '../multiplayer/roomSession';
import { JoinRoomSection } from './JoinRoomSection';

type SelectorState = 'idle' | 'scanning' | 'summary' | 'error';

interface ForkSelectorProps {
  onReady: (provider: ResourceProvider, forkName: string) => void;
  builtInAvailable: boolean;
  builtInForkName: string;
  multiplayer: UseMultiplayerResult;
  /** Called once the guest's P2P connection to the host is open — the app should switch
   *  to a RemoteResourceProvider and skip fork selection entirely. */
  onJoinedWithoutFork: () => void;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
const supportsWebkitDirectory = (() => {
  if (typeof document === 'undefined') return false;
  const input = document.createElement('input');
  return 'webkitdirectory' in input;
})();
const canPickFolder = supportsDirectoryPicker || supportsWebkitDirectory;

export const ForkSelector: React.FC<ForkSelectorProps> = ({
  onReady,
  builtInAvailable,
  builtInForkName,
  multiplayer,
  onJoinedWithoutFork,
}) => {
  const { t } = useT();
  const [phase, setPhase] = useState<SelectorState>('idle');
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [summary, setSummary] = useState<RepositorySummary | null>(null);
  const [fileMap, setFileMap] = useState<Map<string, File> | null>(null);
  const [forkName, setForkName] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenFolder = useCallback(async () => {
    if (supportsDirectoryPicker) {
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await (window as any).showDirectoryPicker({ mode: 'read' });
      } catch {
        // User cancelled
        return;
      }

      setPhase('scanning');
      setScanProgress(0);

      try {
        const map = await buildFileMapFromDirectoryHandle(handle, (count) => {
          setScanProgress(count);
        });

        const validation = validateRepository(map);
        if (!validation.valid) {
          setErrorMessage(validation.error ?? t('forkSelector.invalidRepository'));
          setPhase('error');
          return;
        }

        const s = summarizeRepository(map);
        setSummary(s);
        setFileMap(map);
        setForkName(handle.name);
        setPhase('summary');
      } catch (err) {
        setErrorMessage(String(err));
        setPhase('error');
      }
    } else {
      // Fallback: trigger hidden webkitdirectory input
      // Show scanning state immediately, the browser enumerates all files
      // before firing the change event, which can take several seconds
      setPhase('scanning');
      setScanProgress(0);
      fileInputRef.current?.click();
    }
  }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      setPhase('idle');
      return;
    }

    setPhase('scanning');
    setScanProgress(0);
    setScanTotal(files.length);

    try {
      const map = await buildFileMapFromFileList(Array.from(files), (processed, total) => {
        setScanProgress(processed);
        setScanTotal(total);
      });

      const validation = validateRepository(map);
      if (!validation.valid) {
        setErrorMessage(validation.error ?? t('forkSelector.invalidRepository'));
        setPhase('error');
        return;
      }

      const s = summarizeRepository(map);
      setSummary(s);
      setFileMap(map);

      // Derive fork name from first file's webkitRelativePath root segment
      const firstPath = files[0].webkitRelativePath;
      const rootFolder = firstPath.split('/')[0] || t('forkSelector.unknown');
      setForkName(rootFolder);
      setPhase('summary');
    } catch (err) {
      setErrorMessage(String(err));
      setPhase('error');
    }
  }, []);

  const handleLoad = useCallback(() => {
    if (!fileMap) return;
    const provider = new FileSystemResourceProvider(fileMap, forkName);
    onReady(provider, forkName);
  }, [fileMap, forkName, onReady]);

  const handleUseBuiltIn = useCallback(() => {
    const provider = new HttpResourceProvider(BASE_URL, builtInForkName);
    onReady(provider, builtInForkName);
  }, [onReady, builtInForkName]);

  const handleReset = useCallback(() => {
    setPhase('idle');
    setSummary(null);
    setFileMap(null);
    setForkName('');
    setErrorMessage('');
    setScanProgress(0);
    setScanTotal(0);
    // Reset file input so the same folder can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // --- Space background with floating clown + tool icons ---
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let dustImg: HTMLImageElement | null = null;
    let starsImg: HTMLImageElement | null = null;
    let clownImg: HTMLImageElement | null = null;
    let toolImages: HTMLImageElement[] = [];

    // Clown state
    let cx = 0, cy = 0, cvx = 0, cvy = 0, crot = 0, cspin = 0, cscale = 1, cage = 0;
    let clownSpawned = false;

    function spawnClown(w: number, h: number) {
      const size = 48 + Math.random() * 32;
      const speed = 40 + Math.random() * 30;
      const perim = 2 * (w + h);
      const p = Math.random() * perim;
      if (p < w) { cx = p; cy = -size; }
      else if (p < w + h) { cx = w + size; cy = p - w; }
      else if (p < 2 * w + h) { cx = p - w - h; cy = h + size; }
      else { cx = -size; cy = p - 2 * w - h; }
      const angle = Math.atan2(h / 2 - cy, w / 2 - cx) + (Math.random() - 0.5) * 0.8;
      cvx = Math.cos(angle) * speed;
      cvy = Math.sin(angle) * speed;
      crot = Math.random() * Math.PI * 2;
      cspin = (Math.random() - 0.5) * 1.2;
      cscale = size / 64;
      cage = 0;
      clownSpawned = true;
    }

    // Floating tool icons: same drift/tumble behavior as the clown, several at once,
    // each respawning with a freshly-picked random icon once it drifts off-screen.
    interface FloatingTool {
      img: HTMLImageElement; x: number; y: number; vx: number; vy: number;
      rot: number; spin: number; scale: number; age: number;
    }
    const floatingTools: FloatingTool[] = [];
    const TOOL_ICON_COUNT = 6;

    function spawnTool(tool: FloatingTool, w: number, h: number) {
      tool.img = toolImages[Math.floor(Math.random() * toolImages.length)];
      const size = 28 + Math.random() * 20;
      const speed = 25 + Math.random() * 25;
      const perim = 2 * (w + h);
      const p = Math.random() * perim;
      if (p < w) { tool.x = p; tool.y = -size; }
      else if (p < w + h) { tool.x = w + size; tool.y = p - w; }
      else if (p < 2 * w + h) { tool.x = p - w - h; tool.y = h + size; }
      else { tool.x = -size; tool.y = p - 2 * w - h; }
      const angle = Math.atan2(h / 2 - tool.y, w / 2 - tool.x) + (Math.random() - 0.5) * 1.2;
      tool.vx = Math.cos(angle) * speed;
      tool.vy = Math.sin(angle) * speed;
      tool.rot = Math.random() * Math.PI * 2;
      tool.spin = (Math.random() - 0.5) * 1.0;
      tool.scale = size / 32; // tool icons are 32x32
      tool.age = 0;
    }

    // Load images
    const loadImg = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(img); // proceed even on error
        img.src = src;
      });

    let running = true;
    let lastT = 0;

    const TOOL_ICON_NAMES = [
      'access_breaker', 'access_configurator', 'blueprint', 'cable-coils', 'crowbar', 'drill', 'geiger',
      'greenlight', 'jaws_of_life', 'lantern', 'multitool', 'network_configurator', 'rcd', 'screwdriver',
      'spray_painter', 't-ray', 'welder', 'welder_experimental', 'wirecutters', 'wrench',
    ];

    Promise.all([
      loadImg(withBase('/images/space-bg.png')).then(i => { dustImg = i; }),
      loadImg(withBase('/images/space-stars.png')).then(i => { starsImg = i; }),
      loadImg(withBase('/images/clown.png')).then(i => { clownImg = i; }),
      Promise.all(TOOL_ICON_NAMES.map(name => loadImg(withBase(`/images/tool-icons/${name}.png`))))
        .then(imgs => { toolImages = imgs.filter(i => i.naturalWidth > 0); }),
    ]).then(() => {
      if (!running) return;
      lastT = performance.now();
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      spawnClown(w, h);
      if (toolImages.length > 0) {
        for (let i = 0; i < TOOL_ICON_COUNT; i++) {
          const tool: FloatingTool = { img: toolImages[0], x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, scale: 1, age: Math.random() * 2 };
          spawnTool(tool, w, h);
          floatingTools.push(tool);
        }
      }
      draw(lastT);
    });

    function draw(timestamp: number) {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas!.clientWidth;
      const h = canvas!.clientHeight;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const dt = Math.min((timestamp - lastT) / 1000, 0.1);
      lastT = timestamp;

      // Dark background
      ctx!.fillStyle = '#0a0a1a';
      ctx!.fillRect(0, 0, w, h);

      // Tile dust pattern
      if (dustImg && dustImg.naturalWidth > 0) {
        ctx!.globalAlpha = 0.3;
        const pattern = ctx!.createPattern(dustImg, 'repeat');
        if (pattern) {
          ctx!.fillStyle = pattern;
          ctx!.fillRect(0, 0, w, h);
        }
        ctx!.globalAlpha = 1;
      }

      // Tile stars pattern
      if (starsImg && starsImg.naturalWidth > 0) {
        ctx!.globalAlpha = 0.5;
        const pattern = ctx!.createPattern(starsImg, 'repeat');
        if (pattern) {
          ctx!.fillStyle = pattern;
          ctx!.fillRect(0, 0, w, h);
        }
        ctx!.globalAlpha = 1;
      }

      // Floating clown
      if (clownSpawned && clownImg && clownImg.naturalWidth > 0) {
        cage += dt;
        cx += cvx * dt;
        cy += cvy * dt;
        crot += cspin * dt;

        const drawSize = clownImg.width * cscale;
        const margin = drawSize;

        // Respawn if off-screen
        if (cage > 2 && (cx < -margin || cx > w + margin || cy < -margin || cy > h + margin)) {
          spawnClown(w, h);
        }

        const fadeIn = Math.min(cage / 1.5, 1);
        const edgeDist = Math.min(cx + margin, w + margin - cx, cy + margin, h + margin - cy);
        const fadeOut = Math.min(edgeDist / (margin * 2), 1);

        ctx!.save();
        ctx!.globalAlpha = fadeIn * fadeOut * 0.7;
        ctx!.translate(cx, cy);
        ctx!.rotate(crot);
        ctx!.imageSmoothingEnabled = false;
        ctx!.drawImage(clownImg, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx!.restore();
      }

      // Floating tool icons
      for (const tool of floatingTools) {
        if (!tool.img || tool.img.naturalWidth === 0) continue;
        tool.age += dt;
        tool.x += tool.vx * dt;
        tool.y += tool.vy * dt;
        tool.rot += tool.spin * dt;

        const drawSize = tool.img.width * tool.scale;
        const margin = drawSize;

        if (tool.age > 2 && (tool.x < -margin || tool.x > w + margin || tool.y < -margin || tool.y > h + margin)) {
          spawnTool(tool, w, h);
        }

        const fadeIn = Math.min(tool.age / 1.5, 1);
        const edgeDist = Math.min(tool.x + margin, w + margin - tool.x, tool.y + margin, h + margin - tool.y);
        const fadeOut = Math.min(edgeDist / (margin * 2), 1);

        ctx!.save();
        ctx!.globalAlpha = fadeIn * fadeOut * 0.5;
        ctx!.translate(tool.x, tool.y);
        ctx!.rotate(tool.rot);
        ctx!.imageSmoothingEnabled = false;
        ctx!.drawImage(tool.img, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        ctx!.restore();
      }

      animId = requestAnimationFrame(draw);
    }

    return () => {
      running = false;
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div className="fixed inset-0 flex items-center justify-center font-['Segoe_UI',sans-serif]">
      {/* Space background canvas */}
      <canvas
        ref={bgCanvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 0 }}
      />

      {/* Hidden file input fallback for browsers without showDirectoryPicker */}
      <input
        ref={fileInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard
        webkitdirectory=""
        className="hidden"
        onChange={handleFileInputChange}
      />

      <div className="relative z-10 w-full max-w-[500px] mx-4 bg-surface/95 backdrop-blur-sm border border-subtle rounded-xl p-8 shadow-2xl">
        {/* Title.always visible */}
        <h1 className="text-2xl font-bold text-accent text-center mb-1">
          SS14 Map Editor
        </h1>
        <p className="text-sm text-muted text-center mb-8">
          {t('forkSelector.subtitle')}
        </p>

        {/* ---- IDLE ---- */}
        {phase === 'idle' && (
          <div className="flex flex-col gap-4">
            {canPickFolder ? (
              <>
                <button
                  onClick={handleOpenFolder}
                  className="w-full py-3 px-4 rounded-lg bg-accent text-white font-semibold text-sm
                             hover:brightness-110 active:brightness-90 transition-all cursor-pointer
                             border-none outline-none focus:ring-2 focus:ring-accent/50"
                >
                  {t('forkSelector.openFolder')}
                </button>

                {/* Privacy & browser info */}
                <div className="bg-panel rounded-lg p-3 border border-subtle text-xs text-muted leading-relaxed flex flex-col gap-2">
                  <p>
                    <span className="text-primary font-medium">{t('forkSelector.privacyLabel')}</span>{' '}
                    {t('forkSelector.privacyBody')}
                  </p>
                  <p>
                    <span className="text-primary font-medium">{t('forkSelector.browserNoteLabel')}</span>{' '}
                    {supportsDirectoryPicker
                      ? t('forkSelector.browserNoteNative')
                      : <>{t('forkSelector.browserNoteFallbackPre')} <a href="https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API" target="_blank" rel="noopener noreferrer" className="text-accent underline hover:brightness-125">{t('forkSelector.browserNoteFallbackApi')}</a>{t('forkSelector.browserNoteFallbackMid')} <a href="https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory" target="_blank" rel="noopener noreferrer" className="text-accent underline hover:brightness-125">{t('forkSelector.browserNoteFallbackInput')}</a>{t('forkSelector.browserNoteFallbackPost')}</>}
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center text-warning text-sm py-3 px-4 rounded-lg bg-hover border border-subtle">
                {t('forkSelector.noFolderSupport')}
              </div>
            )}

            {builtInAvailable && (
              <button
                onClick={handleUseBuiltIn}
                className="w-full py-3 px-4 rounded-lg bg-elevated text-primary font-medium text-sm
                           hover:bg-hover active:brightness-90 transition-all cursor-pointer
                           border border-subtle outline-none focus:ring-2 focus:ring-accent/50"
              >
                {t('forkSelector.useBuiltIn', { forkName: builtInForkName })}
              </button>
            )}

            <div className="h-px bg-subtle" />

            <JoinRoomSection multiplayer={multiplayer} onJoined={onJoinedWithoutFork} />
          </div>
        )}

        {/* ---- SCANNING ---- */}
        {phase === 'scanning' && (
          <div className="flex flex-col items-center gap-4 w-full">
            {/* Spinner */}
            <div className="w-8 h-8 border-3 border-subtle border-t-accent rounded-full animate-spin" />
            <div className="text-sm text-primary">
              {scanProgress > 0 ? t('forkSelector.scanningRepository') : t('forkSelector.readingFolder')}
            </div>
            {scanTotal > 0 && scanProgress > 0 ? (
              <>
                {/* Determinate progress bar */}
                <div className="w-full max-w-[350px] h-2 bg-panel rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent rounded-full transition-all duration-150"
                    style={{ width: `${Math.min(100, (scanProgress / scanTotal) * 100)}%` }}
                  />
                </div>
                <div className="text-xs text-muted">
                  {t('forkSelector.filesProcessed', { processed: formatNumber(scanProgress), total: formatNumber(scanTotal) })}
                </div>
              </>
            ) : (
              <>
                {/* Indeterminate progress bar (CSS-only animation, works even when JS thread is blocked) */}
                <div className="w-full max-w-[350px] h-2 bg-panel rounded-full overflow-hidden">
                  <div className="h-full bg-accent rounded-full w-[30%] animate-[scanning-slide_1.2s_ease-in-out_infinite]" />
                </div>
                <div className="text-xs text-muted">
                  {!supportsDirectoryPicker
                    ? t('forkSelector.readingAllFiles')
                    : t('forkSelector.mayTakeSeconds')}
                </div>
              </>
            )}
            <button
              onClick={handleReset}
              className="text-xs text-muted hover:text-primary cursor-pointer bg-transparent border-none mt-1"
            >
              {t('forkSelector.cancel')}
            </button>
          </div>
        )}

        {/* CSS animation for indeterminate scanning bar */}
        <style>{`
          @keyframes scanning-slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(430%); }
          }
        `}</style>

        {/* ---- SUMMARY ---- */}
        {phase === 'summary' && summary && (
          <div className="flex flex-col gap-5">
            <div className="text-center">
              <div className="text-sm font-semibold text-success mb-1">
                {t('forkSelector.scannedSuccessfully')}
              </div>
              <div className="text-xs text-muted">
                {forkName}
              </div>
            </div>

            <div className="bg-panel rounded-lg p-4 border border-subtle">
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                <span className="text-muted">{t('forkSelector.entityFiles')}</span>
                <span className="text-primary text-right font-mono">
                  {formatNumber(summary.entityFiles)}
                </span>
                <span className="text-muted">{t('forkSelector.tileFiles')}</span>
                <span className="text-primary text-right font-mono">
                  {formatNumber(summary.tileFiles)}
                </span>
                <span className="text-muted">{t('forkSelector.decalFiles')}</span>
                <span className="text-primary text-right font-mono">
                  {formatNumber(summary.decalFiles)}
                </span>
                <span className="text-muted">{t('forkSelector.catalogFiles')}</span>
                <span className="text-primary text-right font-mono">
                  {formatNumber(summary.catalogFiles)}
                </span>
              </div>

              <div className="border-t border-subtle mt-3 pt-3 flex justify-between text-sm">
                <span className="text-muted">{t('forkSelector.forkDirectories')}</span>
                <span className="text-primary font-mono">
                  {summary.forkDirs.length > 0 ? summary.forkDirs.join(', ') : t('forkSelector.none')}
                </span>
              </div>

              <div className="border-t border-subtle mt-3 pt-3 flex justify-between text-sm font-semibold">
                <span className="text-muted">{t('forkSelector.totalFiles')}</span>
                <span className="text-accent font-mono">
                  {formatNumber(summary.totalFiles)}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleReset}
                className="flex-1 py-2.5 px-4 rounded-lg bg-elevated text-muted font-medium text-sm
                           hover:bg-hover hover:text-primary transition-all cursor-pointer
                           border border-subtle outline-none"
              >
                {t('forkSelector.cancel')}
              </button>
              <button
                onClick={handleLoad}
                className="flex-1 py-2.5 px-4 rounded-lg bg-accent text-white font-semibold text-sm
                           hover:brightness-110 active:brightness-90 transition-all cursor-pointer
                           border-none outline-none focus:ring-2 focus:ring-accent/50"
              >
                {t('forkSelector.load')}
              </button>
            </div>

            <p className="text-xs text-muted text-center leading-relaxed">
              {t('forkSelector.localProcessingNote')}
            </p>
          </div>
        )}

        {/* ---- ERROR ---- */}
        {phase === 'error' && (
          <div className="flex flex-col items-center gap-4">
            <div className="text-sm text-danger text-center leading-relaxed px-2">
              {errorMessage}
            </div>
            <button
              onClick={handleReset}
              className="py-2.5 px-6 rounded-lg bg-elevated text-primary font-medium text-sm
                         hover:bg-hover transition-all cursor-pointer
                         border border-subtle outline-none"
            >
              {t('forkSelector.tryAgain')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
