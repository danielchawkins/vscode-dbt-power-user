/** What a lineage compile achieved, from its exit code and output. */
export type CompileOutcome =
  | { kind: "analyzed" }
  /** `dbt1014`: Fusion could not fetch a parent's schema and set `static_analysis` off for these models. */
  | { kind: "skipped"; models: string[] }
  | {
      kind: "strictUnavailable";
      /**
       * `dbt1000`: the info schema was generated without strict. `licence`: the binary's message for running
       * without a dbt platform account. `emptyAfterStrict`: exit 0, but no lineage for a model with columns.
       */
      signal: "dbt1000" | "licence" | "emptyAfterStrict";
    }
  | { kind: "failed"; exitCode: number; message: string };

// Every string matched against Fusion output lives here (evidence README sections 2, 3 and 7; experiment f1).
const SKIPPED = "dbt1014";
const SKIPPED_MODEL = /Skipping analysis for '([^']+)'/g;
const NO_STRICT = "dbt1000";
const LICENCE = "Strict static analysis will be unavailable";
const ERROR_LINE = /^\[error\].*$/m;

/**
 * Classifies a `dbt compile --static-analysis strict --generate-info-schema`. A non-zero exit is `failed`
 * even when a fall-back warning is also present, because the lineage view was not rewritten.
 */
export function classifyCompile(
  exitCode: number | null | undefined,
  stdout: string,
  stderr: string,
): CompileOutcome {
  const output = `${stderr}\n${stdout}`;
  if (exitCode !== 0) {
    return {
      kind: "failed",
      exitCode: exitCode ?? -1,
      message:
        ERROR_LINE.exec(output)?.[0] ??
        (stderr.trim() || `dbt compile exited with ${exitCode}`),
    };
  }
  if (output.includes(LICENCE)) {
    return { kind: "strictUnavailable", signal: "licence" };
  }
  if (output.includes(NO_STRICT)) {
    return { kind: "strictUnavailable", signal: "dbt1000" };
  }
  if (output.includes(SKIPPED)) {
    const models = [...output.matchAll(SKIPPED_MODEL)].map((match) => match[1]);
    return { kind: "skipped", models: [...new Set(models)] };
  }
  return { kind: "analyzed" };
}

/** A sentence for the panel and status bar. */
export function describeCompileOutcome(outcome: CompileOutcome): string {
  switch (outcome.kind) {
    case "analyzed":
      return "Column lineage is up to date.";
    case "skipped":
      return `Fusion skipped analysis for ${outcome.models.join(", ") || "some models"}: a parent's schema was not available (dbt1014). Build the parent, or type every source column and add the schema-origin hook.`;
    case "strictUnavailable":
      return STRICT_UNAVAILABLE[outcome.signal];
    case "failed":
      return `dbt compile failed: ${outcome.message}`;
  }
}

const STRICT_UNAVAILABLE: Record<
  Extract<CompileOutcome, { kind: "strictUnavailable" }>["signal"],
  string
> = {
  licence:
    "Fusion reports strict static analysis is unavailable without a dbt platform account, so no column lineage was written.",
  dbt1000:
    "The compile ran without strict static analysis (dbt1000), so no column lineage was written.",
  emptyAfterStrict:
    "The compile succeeded but wrote no column lineage for this model; strict analysis may not have taken effect.",
};
