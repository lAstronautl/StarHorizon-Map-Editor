import type { IConnectionManager } from './peerConnection';
import type { NetworkMessage } from './messages';
import { getActiveProvider } from '../loaders/resourceProvider';

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunk to avoid blowing the call stack on String.fromCharCode(...bytes) for large images.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Host-side answer to a guest's RemoteResourceProvider requests: reads through the
 * host's own active ResourceProvider (whatever fork the host has loaded — local folder
 * or built-in) and replies over the same P2P DataChannel. Called from roomSession.ts's
 * handleMessage for 'resource-list-request'/'resource-file-request', host-role only.
 */
export async function handleResourceRequest(
  manager: IConnectionManager,
  fromPeerId: string,
  message: NetworkMessage,
): Promise<void> {
  if (message.type === 'resource-list-request') {
    const { requestId, dir, ext } = message.payload;
    try {
      const paths = await getActiveProvider().listFiles(dir, ext);
      manager.sendTo(fromPeerId, { type: 'resource-list-response', payload: { requestId, paths } });
    } catch {
      manager.sendTo(fromPeerId, { type: 'resource-list-response', payload: { requestId, paths: [] } });
    }
    return;
  }

  if (message.type === 'resource-file-request') {
    const { requestId, path, binary } = message.payload;
    const provider = getActiveProvider();
    try {
      if (!binary) {
        const text = await provider.readText(path);
        manager.sendTo(fromPeerId, { type: 'resource-file-response', payload: { requestId, data: text } });
        return;
      }
      const url = provider.getImageUrl(path);
      if (!url) {
        manager.sendTo(fromPeerId, { type: 'resource-file-response', payload: { requestId, data: null } });
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const buffer = await res.arrayBuffer();
      manager.sendTo(fromPeerId, { type: 'resource-file-response', payload: { requestId, data: arrayBufferToBase64(buffer) } });
    } catch {
      manager.sendTo(fromPeerId, { type: 'resource-file-response', payload: { requestId, data: null } });
    }
  }
}
