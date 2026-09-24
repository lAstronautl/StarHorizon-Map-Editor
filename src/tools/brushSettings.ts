/** Stroke behavior shared by PaintTool and EraseTool: 'hold' paints/erases continuously
 *  while the mouse button is held and moved (the historical behavior); 'click' paints/
 *  erases only the tile clicked on, ignoring movement until the next mouse-down. */
export type StrokeMode = 'hold' | 'click';

export interface BrushSettings {
  strokeMode: StrokeMode;
}

export const DEFAULT_BRUSH_SETTINGS: BrushSettings = {
  strokeMode: 'hold',
};
