import type { LayoutEngine, LayoutEngineId } from "./layoutEngine";
/**
 * The layout engines the panel can run, and the one it runs. Only this file names an adapter, so switching engines is a
 * change here and nowhere else.
 */
import { ownedEngine } from "./ownedEngine";

const ENGINES: Record<LayoutEngineId, LayoutEngine | undefined> = {
  owned: ownedEngine,
  "graph-layout": undefined,
};

const ACTIVE_ENGINE: LayoutEngineId = "owned";

/** The engine with the given id; an engine that is not built yet is an error, not a silent fallback. */
export function engineFor(id: LayoutEngineId = ACTIVE_ENGINE): LayoutEngine {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(`layout engine ${id} is not available`);
  }
  return engine;
}
