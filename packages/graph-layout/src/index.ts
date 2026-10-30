/**
 * @fusion-power-user/graph-layout: the types, presets, `validateGraph`, `layout` and the drawing metrics. README.md
 * describes the pipeline (its "Build order") and the guarantees.
 */
export type * from "./types.js";
export type { LayoutPreset, LayoutPresetName } from "./presets.js";
export { layoutPresets } from "./presets.js";
export { validateGraph } from "./validate.js";
export { LayoutInputError, layout } from "./layout.js";
export type {
  CompareOptions,
  Drawing,
  DrawingComparison,
  DrawnPath,
} from "./metrics.js";
export { compareDrawings, measureDrawing } from "./metrics.js";
export {
  decodeGraph,
  decodeLayout,
  encodeGraph,
  encodeLayout,
  FrameError,
} from "./frame.js";
