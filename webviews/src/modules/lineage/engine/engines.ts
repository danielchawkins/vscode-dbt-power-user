/**
 * The layout engines the panel can run, and which `lineage.engine` value selects each. Only this file names an
 * adapter, so switching engines is a change here and nowhere else.
 */
import type { lineage } from "@fusion-power-user/webview-contract";
import { graphLayoutEngine } from "./graphLayoutEngine";
import type { LayoutEngine } from "./layoutEngine";

const ENGINES: Record<lineage.LineageEngine, LayoutEngine> = {
  balanced: graphLayoutEngine("balanced"),
  thorough: graphLayoutEngine("thorough"),
};

/** The engine that places and routes the cards and their edges. */
export function engineFor(engine: lineage.LineageEngine): LayoutEngine {
  return ENGINES[engine];
}
