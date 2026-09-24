import type { GridData } from '../state/gridData';
import type { NetworkedAction } from './networkDispatch';
import type { TileChange } from '../types';

/** PaintTool's uncommitted brush stroke: tiles queued but not yet dispatched as a Command. */
export interface PaintPreviewSnapshot {
  tool: 'paint';
  tileChanges: TileChange[];
}

/** SelectTool's in-progress marquee rectangle (world tile coords, inclusive) or a committed
 *  selection being dragged to a new position. */
export interface SelectPreviewSnapshot {
  tool: 'select';
  phase: 'selecting' | 'moving';
  minX: number; minY: number; maxX: number; maxY: number;
  /** Only set while phase is 'moving': how far the selection has been dragged so far. */
  offsetX?: number;
  offsetY?: number;
}

export type ToolPreviewSnapshot = PaintPreviewSnapshot | SelectPreviewSnapshot;

/** Everything a joining peer needs to reproduce the host's current map state. */
export interface NetworkSnapshot {
  grids: GridData[];
  activeGridIndex: number;
  nextEntityId: number;
  /** The peerIndex assigned to the joining peer by the host, for UID namespacing. */
  assignedPeerIndex: number;
  localEntityCounter: number;
  localGridCounter: number;
  /** Active resource fork name, so the joiner can verify/load the same assets. */
  forkName: string | null;
}

/** A player's live cursor position plus any uncommitted tool preview (paint stroke, marquee, etc). */
export interface PresencePayload {
  peerId: string;
  peerIndex: number;
  name: string;
  color: string;
  cursorTileX: number | null;
  cursorTileY: number | null;
  preview: ToolPreviewSnapshot | null;
}

/** Guest → host: "list files in this directory matching this extension", mirroring
 *  ResourceProvider.listFiles. requestId lets the guest match the (async) reply. */
export interface ResourceListRequest {
  requestId: number;
  dir: string;
  ext: string;
}

export interface ResourceListResponse {
  requestId: number;
  paths: string[];
}

/** Guest → host: "send me this file's contents", mirroring ResourceProvider.readText/
 *  getImageUrl. `binary` distinguishes text (YAML/JSON) from images, so the guest knows
 *  whether `data` is a UTF-8 string or a base64-encoded PNG. */
export interface ResourceFileRequest {
  requestId: number;
  path: string;
  binary: boolean;
}

export interface ResourceFileResponse {
  requestId: number;
  /** UTF-8 text for binary:false, base64 for binary:true. Null if the host doesn't have this file. */
  data: string | null;
}

export type NetworkMessage =
  | { type: 'action'; action: NetworkedAction; seq: number }
  | { type: 'snapshot-request'; name: string }
  | { type: 'snapshot'; payload: NetworkSnapshot }
  | { type: 'presence'; payload: PresencePayload }
  | { type: 'peer-info'; peerId: string; peerIndex: number; name: string; color: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'resource-list-request'; payload: ResourceListRequest }
  | { type: 'resource-list-response'; payload: ResourceListResponse }
  | { type: 'resource-file-request'; payload: ResourceFileRequest }
  | { type: 'resource-file-response'; payload: ResourceFileResponse };
