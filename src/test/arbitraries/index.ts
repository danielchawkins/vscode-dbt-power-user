import fc from "fast-check";

/** Runs per property; fixed so CI time is stable, and the seed is printed by fast-check on failure. */
export const NUM_RUNS = 200;

/** A path segment VS Code and dbt would both accept: no separators, not `.` or `..`. */
export const segment = fc
  .stringMatching(/^[a-z0-9_][a-z0-9_.-]{0,11}$/)
  .filter((s) => s !== "." && s !== "..");

/** A relative directory of one to three segments, joined with `/`. */
export const relativeDir = fc
  .array(segment, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("/"));

export const staticAnalysisMode = fc.constantFrom(
  "project",
  "off",
  "baseline",
  "strict",
) as fc.Arbitrary<"project" | "off" | "baseline" | "strict">;

export const traceLevel = fc.constantFrom(
  "off",
  "messages",
  "verbose",
) as fc.Arbitrary<"off" | "messages" | "verbose">;
