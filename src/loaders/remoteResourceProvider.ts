import type { ResourceProvider } from './resourceProvider';
import type { IConnectionManager } from '../multiplayer/peerConnection';
import type { NetworkMessage, ResourceFileResponse, ResourceListResponse } from '../multiplayer/messages';

const REQUEST_TIMEOUT_MS = 15000;

function base64ToBlobUrl(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/png' });
  return URL.createObjectURL(blob);
}

/**
 * ResourceProvider that pulls files from the host over the multiplayer P2P DataChannel
 * instead of the local disk or a built-in HTTP bundle — lets a guest join without having
 * any SS14 fork checked out locally at all. Files are fetched lazily, one request per
 * unseen path, and cached forever afterward (a map/session doesn't change forks mid-flight).
 *
 * `getImageUrl` is the one interesting case: every caller in this codebase treats it as
 * synchronous (they hand the return value straight to `img.src`), but the actual bytes
 * only arrive asynchronously over the network. The first call for a given path returns
 * `''` (already-established convention for "no image yet" — see gridRenderer.getTileImage)
 * and kicks off the fetch in the background; `onResourceReady(path)` fires once the blob
 * URL is cached, so callers know to re-invoke getImageUrl and get the real URL that time.
 */
export class RemoteResourceProvider implements ResourceProvider {
  readonly forkName: string;
  readonly isLocal = false;

  private manager: IConnectionManager;
  private nextRequestId = 1;
  private pendingList = new Map<number, { resolve: (paths: string[]) => void; reject: (err: Error) => void }>();
  private pendingFile = new Map<number, { resolve: (data: string | null) => void; reject: (err: Error) => void }>();
  private textCache = new Map<string, Promise<string>>();
  private imageUrlCache = new Map<string, string>(); // path -> blob URL, once resolved
  private imageInFlight = new Set<string>();
  private blobUrls: string[] = [];
  private onResourceReady: (path: string) => void;

  constructor(manager: IConnectionManager, forkName: string, onResourceReady: (path: string) => void) {
    this.manager = manager;
    this.forkName = forkName;
    this.onResourceReady = onResourceReady;
  }

  /** Feed incoming 'resource-list-response'/'resource-file-response' messages here
   *  (roomSession.ts's handleMessage routes them in alongside everything else). */
  handleResourceMessage(message: NetworkMessage): void {
    if (message.type === 'resource-list-response') {
      const { requestId, paths } = message.payload as ResourceListResponse;
      this.pendingList.get(requestId)?.resolve(paths);
      this.pendingList.delete(requestId);
    } else if (message.type === 'resource-file-response') {
      const { requestId, data } = message.payload as ResourceFileResponse;
      this.pendingFile.get(requestId)?.resolve(data);
      this.pendingFile.delete(requestId);
    }
  }

  async listFiles(dir: string, ext: string): Promise<string[]> {
    const requestId = this.nextRequestId++;
    const promise = new Promise<string[]>((resolve, reject) => {
      this.pendingList.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingList.has(requestId)) {
          this.pendingList.delete(requestId);
          reject(new Error(`Timed out listing ${dir}`));
        }
      }, REQUEST_TIMEOUT_MS);
    });
    this.manager.broadcast({ type: 'resource-list-request', payload: { requestId, dir, ext } });
    return promise;
  }

  async readText(path: string): Promise<string> {
    const cached = this.textCache.get(path);
    if (cached) return cached;

    const promise = this.requestFile(path, false).then((data) => {
      if (data === null) throw new Error(`File not found on host: ${path}`);
      return data;
    });
    this.textCache.set(path, promise);
    return promise;
  }

  /** Synchronous by contract (see class doc) — returns '' until the image has arrived. */
  getImageUrl(path: string): string {
    const key = path.startsWith('/') ? path : `/${path}`;
    const cached = this.imageUrlCache.get(key);
    if (cached) return cached;
    if (this.imageInFlight.has(key)) return '';

    this.imageInFlight.add(key);
    this.requestFile(key, true).then((data) => {
      this.imageInFlight.delete(key);
      if (data === null) return; // host doesn't have this file either — stays a placeholder
      const url = base64ToBlobUrl(data);
      this.blobUrls.push(url);
      this.imageUrlCache.set(key, url);
      this.onResourceReady(key);
    }).catch(() => {
      this.imageInFlight.delete(key);
    });
    return '';
  }

  private requestFile(path: string, binary: boolean): Promise<string | null> {
    const requestId = this.nextRequestId++;
    const promise = new Promise<string | null>((resolve, reject) => {
      this.pendingFile.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingFile.has(requestId)) {
          this.pendingFile.delete(requestId);
          reject(new Error(`Timed out reading ${path}`));
        }
      }, REQUEST_TIMEOUT_MS);
    });
    this.manager.broadcast({ type: 'resource-file-request', payload: { requestId, path, binary } });
    return promise;
  }

  dispose(): void {
    for (const url of this.blobUrls) URL.revokeObjectURL(url);
    this.blobUrls = [];
    this.imageUrlCache.clear();
    this.textCache.clear();
    this.pendingList.clear();
    this.pendingFile.clear();
  }
}
