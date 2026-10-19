import { firstLogLine } from "../cli/output";
import type { AnsweredTypes, TypeSource } from "./typeProposals";

/** One source tried for a model's column types, and how it ended. */
export interface Attempt {
  source: TypeSource;
  result: "answered" | "missing" | "failed" | "notConfigured" | "unavailable";
  /**
   * The raw error for `failed`, of which only the first line is shown. For a deferred `notConfigured`, the reason:
   * `default`, `off`, `unset` or `unusable`.
   */
  detail?: string;
  /** The target that the describe output named. */
  target?: string;
  /** The relation that the describe output resolved to. */
  relation?: string;
  /** The defer state directory, or for an `unusable` defer, the configured path. */
  state?: string;
}

/** What was tried for one model. `answered` is the answer when a source gave one; the notice is built without it. */
export interface TypeSourceOutcome {
  attempts: Attempt[];
  answered?: AnsweredTypes;
}

const quote = (text: string) => `\`${text}\``;

const isText = (value: string | false | undefined): value is string =>
  Boolean(value);

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** `a`, `a or b`, or `a, b, or c`. */
function joinOr(items: string[]): string {
  if (items.length <= 2) {
    return items.join(" or ");
  }
  return `${items.slice(0, -1).join(", ")}, or ${items.slice(-1).join("")}`;
}

function targetClause(
  model: string,
  attempt: Attempt | undefined,
): string | undefined {
  if (attempt?.result === "missing") {
    const where =
      attempt.target === undefined ? "" : ` in target ${quote(attempt.target)}`;
    return `${quote(model)} is not built${where}`;
  }
  if (attempt?.result === "failed") {
    const where =
      attempt.target === undefined ? "" : ` in target ${quote(attempt.target)}`;
    const line = firstLogLine(attempt.detail ?? "");
    return `describing ${quote(model)}${where} failed${line === "" ? "" : `: ${line}`}`;
  }
  return undefined;
}

function notConfiguredClause(attempt: Attempt): string {
  switch (attempt.detail) {
    case "unset":
      return "defer is enabled without `manifestPathForDeferral`";
    case "unusable":
      return `${quote(attempt.state ?? "the defer state")} is neither a directory nor a ${quote("manifest.json")}`;
    case undefined:
    case "default":
    case "off":
    default:
      return "no deferred relation is configured";
  }
}

function deferredClause(
  model: string,
  attempt: Attempt | undefined,
): string | undefined {
  switch (attempt?.result) {
    case "missing":
      return [
        "the deferred relation",
        attempt.relation === undefined ? undefined : quote(attempt.relation),
        attempt.state === undefined
          ? undefined
          : `from state ${quote(attempt.state)}`,
        "does not exist either",
      ]
        .filter(isText)
        .join(" ");
    case "failed": {
      const line = firstLogLine(attempt.detail ?? "");
      return `describing ${quote(model)} in the deferred state failed${line === "" ? "" : `: ${line}`}`;
    }
    case "notConfigured":
      return notConfiguredClause(attempt);
    case "answered":
    case "unavailable":
    case undefined:
      return undefined;
  }
}

/**
 * The notice for a model whose column types no source answered. It names what was tried and what to do, and never
 * shows the raw error: only the first line of a failed attempt's error. `inferredReason` says why the inferred types
 * are unavailable, and is added unless they were offered.
 */
export function typeSourceMessage(
  model: string,
  outcome: TypeSourceOutcome,
  inferredReason?: string,
): string {
  const attempt = (source: TypeSource) =>
    outcome.attempts.find((tried) => tried.source === source);
  const target = attempt("target");
  const deferred = attempt("deferred");
  const inferred = attempt("inferred");
  const subject = [targetClause(model, target), deferredClause(model, deferred)]
    .filter(isText)
    .join(", and ");
  const actions = [
    target?.result === "missing" &&
      `Build it with ${quote(`dbt run -s ${model}`)}`,
    deferred?.result === "notConfigured" && "set up defer",
    inferred?.result === "answered" && "use the inferred types",
  ].filter(isText);
  return [
    subject && `${capitalize(subject)}.`,
    actions.length > 0 && `${capitalize(joinOr(actions))}.`,
    inferred?.result !== "answered" && inferredReason,
  ]
    .filter(isText)
    .join(" ");
}
