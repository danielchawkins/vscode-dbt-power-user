/**
 * @fusion-power-user/graph-layout. The first phases ship the types, presets, `validateGraph` and the drawing metrics;
 * `layout` lands with the later phases (README.md, "Build order").
 */
export type * from "./types.js";
export type { LayoutPreset, LayoutPresetName } from "./presets.js";
export { layoutPresets } from "./presets.js";
export { validateGraph } from "./validate.js";
export type {
  CompareOptions,
  Drawing,
  DrawingComparison,
  DrawnPath,
} from "./metrics.js";
export { compareDrawings, measureDrawing } from "./metrics.js";
