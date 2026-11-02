/**
 * The layout engines the panel can run, and which `lineage.engine` value selects each. Only this file names an
 * adapter, so switching engines is a change here and nowhere else. The Rust engines lay out in the host, so the caller
 * that owns the host's transport passes it in: this module reads no transport of its own.
 */
import type { lineage } from "@fusion-power-user/webview-contract";
import {
  graphLayoutEngine,
  type LayoutTransport,
  rustLayoutEngine,
} from "./graphLayoutEngine";
import type { LayoutEngine } from "./layoutEngine";

const ENGINES: Record<"balanced" | "thorough", LayoutEngine> = {
  balanced: graphLayoutEngine("balanced"),
  thorough: graphLayoutEngine("thorough"),
};

/**
 * The engine that places and routes the cards and their edges. A Rust engine needs `transport`, which reaches the
 * host's Worker; without one it throws, since no answer could come back.
 */
export function engineFor(
  engine: lineage.LineageEngine,
  transport?: LayoutTransport,
): LayoutEngine {
  if (engine === "rust-balanced" || engine === "rust-thorough") {
    if (!transport) {
      throw new Error(`${engine} lays out in the host and needs its transport`);
    }
    return rustLayoutEngine(
      engine === "rust-balanced" ? "balanced" : "thorough",
      transport,
    );
  }
  return ENGINES[engine];
}
