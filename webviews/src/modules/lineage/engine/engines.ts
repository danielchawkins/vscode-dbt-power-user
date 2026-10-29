/**
 * The layout engines the panel can run, and which `lineage.engine` value selects each. Only this file names an
 * adapter, so switching engines is a change here and nowhere else.
 */
import type { lineage } from "@fusion-power-user/webview-contract";
import { graphLayoutEngine } from "./graphLayoutEngine";
import type { LayoutEngine } from "./layoutEngine";
import { ownedEngine } from "./ownedEngine";

const ENGINES: Record<lineage.LineageEngine, LayoutEngine> = {
  balanced: graphLayoutEngine("balanced"),
  thorough: graphLayoutEngine("thorough"),
  classic: ownedEngine,
};

/** The engine that places and routes the `layered` layout. */
export function engineFor(engine: lineage.LineageEngine): LayoutEngine {
  return ENGINES[engine];
}
