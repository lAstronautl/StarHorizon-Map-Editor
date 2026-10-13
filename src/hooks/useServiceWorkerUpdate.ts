import { useEffect, useRef, useState, useCallback } from 'react';
import { withBase } from '../basePath';

/** How often to poll for a new version while the tab is open, on top of the checks that
 *  already happen on load and when the tab regains focus — mirrors the cadence used by
 *  AnroxComputer-Site's own update banner (see _javascript/pwa/app.js there), so a long-
 *  lived tab still notices a deploy without the user having to switch away and back. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** True exactly when there's a worker ready to take over an already-controlled page (not
 *  the very first install, which has no controller yet and needs no banner). */
export function shouldShowUpdateBanner(hasWaitingWorker: boolean, hasController: boolean): boolean {
  return hasWaitingWorker && hasController;
}

export interface ServiceWorkerUpdateState {
  updateAvailable: boolean;
  /** Activates the waiting worker and reloads once it takes control. */
  applyUpdate: () => void;
  dismiss: () => void;
}

/** Registers the service worker (public/sw.js) and surfaces when a new version is ready
 *  to take over, so the UI can offer a reload instead of leaving the user on a stale
 *  cached build indefinitely — GitHub Pages can't set cache-control headers, so the
 *  browser's own HTTP cache won't do this for us on its own. */
export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let cancelled = false;

    const showIfWaiting = () => {
      if (shouldShowUpdateBanner(!!registration?.waiting, !!navigator.serviceWorker.controller)) {
        waitingWorkerRef.current = registration!.waiting;
        setUpdateAvailable(true);
      }
    };

    // A worker left waiting from an earlier visit (e.g. the banner was dismissed, or the
    // tab was closed before it finished installing) should still surface immediately,
    // not only the next time a *new* update is found.
    const check = () => {
      registration?.update().then(showIfWaiting).catch(() => {});
    };

    const onVisibilityChange = () => {
      if (!document.hidden) check();
    };

    const onUpdateFound = () => {
      const worker = registration?.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        showIfWaiting();
      });
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;

    navigator.serviceWorker.register(withBase('/sw.js')).then((reg) => {
      if (cancelled) return;
      registration = reg;
      showIfWaiting();
      check();
      reg.addEventListener('updatefound', onUpdateFound);
      document.addEventListener('visibilitychange', onVisibilityChange);
      intervalId = setInterval(check, POLL_INTERVAL_MS);
    }).catch(() => {});

    return () => {
      cancelled = true;
      registration?.removeEventListener('updatefound', onUpdateFound);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const worker = waitingWorkerRef.current;
    if (!worker) {
      window.location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    }, { once: true });
    worker.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  const dismiss = useCallback(() => setUpdateAvailable(false), []);

  return { updateAvailable, applyUpdate, dismiss };
}
