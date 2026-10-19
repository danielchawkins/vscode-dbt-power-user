import type { columnProposals } from "@fusion-power-user/webview-contract";
import type {
  AnsweredTypes,
  DocColumn,
} from "../../core/columns/typeProposals";
import { typeProposals } from "../../core/columns/typeProposals";
import type { TypeSourceOutcome } from "../../core/columns/typeSourceMessage";
import { typeSourceMessage } from "../../core/columns/typeSourceMessage";
import type { Log } from "../../core/log";
import type { NeedsStrict } from "../../projects/registry/strictNeeded";
import type { ModelRef, TypeSourceProject } from "./columnTypeSource";
import { resolveColumnTypes } from "./columnTypeSource";
import { withProgress } from "./docsEditHandlers";

/** The proposal kinds the service answers. */
export type ProposalKind = "types";

/** The name and data type of each column, without a data type the YAML leaves unset. */
export function docColumns(
  columns: { name: string; type?: string | null | undefined }[],
): DocColumn[] {
  return columns.map(({ name, type }) => (type ? { name, type } : { name }));
}

/** The documentation a proposal is made for: the draft's columns when one is unsaved, else the YAML's. */
export interface ProposalTarget {
  model: ModelRef;
  yaml: DocColumn[];
  draft?: DocColumn[] | undefined;
  project: TypeSourceProject;
}

export interface ColumnProposalDeps {
  log: Log;
  columnsNeedStrict: () => NeedsStrict | undefined;
}

/**
 * Answers proposal requests under cancellable progress. A newer request for the same kind and model aborts the older
 * one, and an aborted or superseded request resolves `undefined`.
 */
export class ColumnProposalService {
  /** The newest request per kind and model file. */
  private readonly latest = new Map<string, AbortController>();
  private readonly deps: ColumnProposalDeps;

  constructor(deps: ColumnProposalDeps) {
    this.deps = deps;
  }

  async propose(
    kind: ProposalKind,
    target: ProposalTarget,
  ): Promise<columnProposals.ColumnProposalsPayload | undefined> {
    const key = `${kind}\0${target.model.filePath}`;
    this.latest.get(key)?.abort();
    const request = new AbortController();
    this.latest.set(key, request);
    try {
      const payload = await withProgress(
        `Describing ${target.model.name}…`,
        (cancelled) => {
          cancelled.addEventListener("abort", () => request.abort(), {
            once: true,
          });
          return this.typesFor(target, request.signal);
        },
        true,
      );
      return request.signal.aborted || this.latest.get(key) !== request
        ? undefined
        : payload;
    } catch (error) {
      if (request.signal.aborted) {
        return undefined;
      }
      throw error;
    } finally {
      if (this.latest.get(key) === request) {
        this.latest.delete(key);
      }
    }
  }

  private async typesFor(
    target: ProposalTarget,
    signal: AbortSignal,
  ): Promise<columnProposals.ColumnProposalsPayload> {
    const needs = this.deps.columnsNeedStrict();
    const outcome = await resolveColumnTypes(target.project, target.model, {
      log: this.deps.log,
      columnsNeedStrict: () => needs,
      signal,
    });
    return payloadOf(target, outcome, needs !== undefined);
  }
}

/**
 * The payload for a model's outcome. The notice is added only when neither the target nor the deferred source answered:
 * a warning when inferred types are offered, an error when nothing is. `strictNeeded` says the inferred types are
 * unavailable because static analysis is not strict, which adds the button that turns it on.
 */
function payloadOf(
  target: ProposalTarget,
  outcome: TypeSourceOutcome,
  strictNeeded: boolean,
): columnProposals.ColumnProposalsPayload {
  const { model } = target;
  const { answered } = outcome;
  const typed = answered
    ? typeProposals(target.draft ?? target.yaml, answered)
    : { proposals: [], notFound: [] };
  const offered =
    answered?.source === "target" || answered?.source === "deferred";
  const inferred = outcome.attempts.find(({ source }) => source === "inferred");
  const needsStrictAction = strictNeeded && inferred?.result === "unavailable";
  return {
    kind: "types",
    model: model.filePath,
    ...(answered ? { source: sourceOf(answered) } : {}),
    proposals: typed.proposals,
    notFound: typed.notFound,
    ...(offered
      ? {}
      : {
          notice: {
            message: typeSourceMessage(
              model.name,
              outcome,
              inferred?.result === "unavailable" ? inferred.detail : undefined,
            ),
            type: answered?.source === "inferred" ? "warning" : "error",
            ...(needsStrictAction
              ? {
                  actions: [
                    {
                      title: "Use strict analysis",
                      action: "useStrictAnalysis",
                    },
                  ],
                }
              : {}),
          },
        }),
  };
}

/** The structured source of answered types. The describe path always sets the target and relation, so the fallbacks never apply. */
function sourceOf(answered: AnsweredTypes): columnProposals.ProposalSource {
  switch (answered.source) {
    case "target":
      return {
        kind: "target",
        target: answered.target ?? "",
        relation: answered.relation ?? "",
      };
    case "deferred":
      return {
        kind: "deferred",
        target: answered.target ?? "",
        relation: answered.relation ?? "",
        state: answered.state ?? "",
      };
    case "inferred":
      return { kind: "inferred" };
  }
}
