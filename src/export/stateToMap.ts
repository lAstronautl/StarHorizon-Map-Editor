import type { ImportedMap } from '../import/mapImporter';
import type { EditorState } from '../state/editorState';

/** The editor state as the `ImportedMap` the exporters take (what App's save buttons pass on). */
export function stateToImportedMap(state: EditorState): ImportedMap {
  return {
    meta: state.meta,
    tilemap: state.tilemap ?? {},
    grid: state.grid,
    entities: state.entities,
    containedEntities: state.containedEntities,
    gridUid: state.gridUid,
    mapUid: state.mapUid,
    maps: state.maps,
    grids: state.gridUidList,
    orphans: state.orphans,
    nullspace: state.nullspace,
    gridDataList: state.grids,
    structuralEntityData: state.structuralEntityData,
    entityRawComponents: state.entityRawComponents,
    entityRawPreamble: state.entityRawPreamble,
    chunkKeyOrder: state.chunkKeyOrder,
    lineEnding: state.lineEnding,
    hasDocumentTerminator: state.hasDocumentTerminator,
    entityOrder: state.entityOrder,
  };
}
