import { LineageExclusions } from "../features/lineage/lineageExclusion";
import { silentLog } from "./testLog";

/**
 * A resolver with no server and no CLI, so every rule fails and excludes nothing. Tests that do not exercise
 * exclusion pass it to `LineageService`, so they never reach dbt.
 */
export function unavailableExclusions(): LineageExclusions {
  return new LineageExclusions({
    server: () => undefined,
    cli: () => {
      throw new Error("no dbt CLI in this test");
    },
    log: silentLog(),
  });
}
