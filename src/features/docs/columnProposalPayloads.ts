import type { columnProposals } from "@fusion-power-user/webview-contract";
import type {
  AnsweredTypes,
  DocColumn,
} from "../../core/columns/typeProposals";
import { typeProposals } from "../../core/columns/typeProposals";
import type { TypeSourceOutcome } from "../../core/columns/typeSourceMessage";
import { typeSourceMessage } from "../../core/columns/typeSourceMessage";
import type { NeedsStrict } from "../../projects/registry/strictNeeded";
import { strictNeededMessage } from "../../projects/registry/strictNeeded";
import type { ModelRef } from "./columnTypeSource";
import type { UpstreamDescriptionOutcome } from "./upstreamDescriptionSource";

/** The parts of a proposal target that the type payload reads. */
export interface TypeTarget {
  model: ModelRef;
  yaml: DocColumn[];
  draft?: DocColumn[] | undefined;
}

/**
 * The payload for a model's type outcome. The notice is added only when neither the target nor the deferred source answered:
 * a warning when inferred types are offered, an error when nothing is. `strictNeeded` says the inferred types are
 * unavailable because static analysis is not strict, which adds the button that turns it on.
 */
export function payloadOf(
  target: TypeTarget,
  outcome: TypeSourceOutcome,
  strictNeeded: boolean,
): columnProposals.TypeProposalsPayload {
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

/**
 * The payload for an upstream-description outcome. A stopped client, a non-strict mode and a failed request each give a
 * notice, and so does a walk that finds no proposal. The non-strict notice carries the button that turns strict analysis
 * on, as the type notice does.
 */
export function descriptionPayloadOf(
  model: ModelRef,
  outcome: UpstreamDescriptionOutcome,
  needs: NeedsStrict | undefined,
): columnProposals.DescriptionProposalsPayload {
  switch (outcome.kind) {
    case "notRunning":
      return {
        kind: "descriptions",
        model: model.filePath,
        proposals: [],
        notice: {
          message: `Upstream descriptions need the Fusion language server running; it is ${outcome.state}.`,
          type: "error",
        },
      };
    case "needsStrict":
      return {
        kind: "descriptions",
        model: model.filePath,
        proposals: [],
        notice: {
          message: needs
            ? strictNeededMessage(needs, "Proposing upstream descriptions")
            : "Upstream descriptions need strict static analysis.",
          type: "warning",
          actions: [
            { title: "Use strict analysis", action: "useStrictAnalysis" },
          ],
        },
      };
    case "failed":
      return {
        kind: "descriptions",
        model: model.filePath,
        proposals: outcome.proposals,
        notice: {
          message: `Upstream descriptions could not be read: ${outcome.message}`,
          type: "error",
        },
      };
    case "found":
      return {
        kind: "descriptions",
        model: model.filePath,
        proposals: outcome.proposals,
        ...(outcome.asked > 0 && outcome.proposals.length === 0
          ? {
              notice: {
                message:
                  "No upstream copy has a description for the columns without one.",
                type: "warning",
              },
            }
          : {}),
      };
  }
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
