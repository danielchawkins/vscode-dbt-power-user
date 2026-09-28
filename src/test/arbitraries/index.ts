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

const SQL_KEYWORDS = new Set(["as", "with", "select", "from", "recursive"]);

/** An unquoted SQL identifier that is not a keyword the CTE detector treats specially. */
export const sqlIdentifier = fc
  .stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,11}$/)
  .filter((s) => !SQL_KEYWORDS.has(s.toLowerCase()));

const commentText = fc.stringMatching(/^[a-z ]{0,16}$/);

/** Whitespace, newlines, and SQL line or block comments, as may appear between tokens. */
export const sqlGap = fc
  .array(
    fc.oneof(
      fc.constantFrom(" ", "\n", "\t", "\r\n"),
      commentText.map((t) => `--${t}\n`),
      commentText.map((t) => `/*${t}*/`),
    ),
    { maxLength: 4 },
  )
  .map((parts) => parts.join(""));

/** Node ids `model.p.n<i>` with depends_on edges only to lower-indexed nodes, so the graph is acyclic. */
export const nodeDag = fc
  .integer({ min: 1, max: 12 })
  .chain((n) =>
    fc.tuple(
      ...Array.from({ length: n }, (_, i) =>
        fc.subarray(Array.from({ length: i }, (_, j) => `model.p.n${j}`)),
      ),
    ),
  )
  .map((parents) =>
    Object.fromEntries(
      parents.map((deps, i) => {
        const id = `model.p.n${i}`;
        return [
          id,
          { unique_id: id, name: `n${i}`, depends_on: { nodes: deps } },
        ];
      }),
    ),
  );

export const traceLevel = fc.constantFrom(
  "off",
  "messages",
  "verbose",
) as fc.Arbitrary<"off" | "messages" | "verbose">;
