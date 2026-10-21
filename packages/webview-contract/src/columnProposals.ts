import type { PanelNotice } from "./common.js";
import { isPanelNotice } from "./common.js";
import type { DocumentationColumn } from "./documentationEditor.js";
import { arrayOf, isString, optional, oneOf, shape } from "./guards.js";

/** Where a proposal's types came from: the target or the deferred state's relation, or the language server. */
export type ProposalSource =
  | { kind: "target"; target: string; relation: string }
  | { kind: "deferred"; target: string; relation: string; state: string }
  | { kind: "inferred" };

/** A change to one column's `data_type`: `fill` an empty one, `add` a missing column or `overwrite` a different one. */
export interface TypeProposal {
  column: string;
  type: string;
  change: "fill" | "add" | "overwrite";
  /** The YAML type that an `overwrite` replaces. */
  current?: string | undefined;
}

/** The type proposals for one model, with the source that answered and, when no target or deferred source did, a notice. */
export interface TypeProposalsPayload {
  kind: "types";
  /** The model's file path, which is how the panel keys its drafts. */
  model: string;
  source?: ProposalSource | undefined;
  proposals: TypeProposal[];
  /** YAML columns that the answering source does not list. They are reported and never edited. */
  notFound: string[];
  /** A warning when inferred types are offered, an error when no source answered. */
  notice?: PanelNotice | undefined;
}

/** One column of one node: `uniqueId` is the node's unique id and `column` its column name. */
export interface ColumnRef {
  uniqueId: string;
  column: string;
}

/** Ancestors that share one description. Several candidates mean the upstream descriptions disagree. */
export interface DescriptionCandidate {
  description: string;
  sources: ColumnRef[];
}

/** The candidate descriptions for one column of the model that has none. */
export interface DescriptionProposal {
  column: string;
  candidates: DescriptionCandidate[];
}

/** The description proposals for one model, with a notice when Fusion could not answer. */
export interface DescriptionProposalsPayload {
  kind: "descriptions";
  /** The model's file path, which is how the panel keys its drafts. */
  model: string;
  proposals: DescriptionProposal[];
  notice?: PanelNotice | undefined;
}

/** What `ColumnProposalService` answers with: type proposals or description proposals. */
export type ColumnProposalsPayload =
  | TypeProposalsPayload
  | DescriptionProposalsPayload;

const isTargetSource = shape<Extract<ProposalSource, { kind: "target" }>>({
  kind: oneOf("target"),
  target: isString,
  relation: isString,
});

const isDeferredSource = shape<Extract<ProposalSource, { kind: "deferred" }>>({
  kind: oneOf("deferred"),
  target: isString,
  relation: isString,
  state: isString,
});

const isInferredSource = shape<Extract<ProposalSource, { kind: "inferred" }>>({
  kind: oneOf("inferred"),
});

const isProposalSource = (value: unknown): value is ProposalSource =>
  isTargetSource(value) || isDeferredSource(value) || isInferredSource(value);

const isTypeProposal = shape<TypeProposal>({
  column: isString,
  type: isString,
  change: oneOf("fill", "add", "overwrite"),
  current: optional(isString),
});

const isTypeProposalsPayload = shape<TypeProposalsPayload>({
  kind: oneOf("types"),
  model: isString,
  source: optional(isProposalSource),
  proposals: arrayOf(isTypeProposal),
  notFound: arrayOf(isString),
  notice: optional(isPanelNotice),
});

const isColumnRef = shape<ColumnRef>({
  uniqueId: isString,
  column: isString,
});

const isDescriptionCandidate = shape<DescriptionCandidate>({
  description: isString,
  sources: arrayOf(isColumnRef),
});

const isDescriptionProposal = shape<DescriptionProposal>({
  column: isString,
  candidates: arrayOf(isDescriptionCandidate),
});

const isDescriptionProposalsPayload = shape<DescriptionProposalsPayload>({
  kind: oneOf("descriptions"),
  model: isString,
  proposals: arrayOf(isDescriptionProposal),
  notice: optional(isPanelNotice),
});

export const isColumnProposalsPayload = (
  value: unknown,
): value is ColumnProposalsPayload =>
  isTypeProposalsPayload(value) || isDescriptionProposalsPayload(value);

const isBlank = (value: string | null | undefined) =>
  (value ?? "").trim() === "";

const sameName = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

/**
 * `columns` with `proposals` applied, checked against the columns as they are now. A `fill` sets only an empty type.
 * An `overwrite` sets the type, and marks it `replaceType`, only when `choices` ticks that column (keyed by its
 * lower-cased name) and the type still reads as the proposal's `current`. An `add` appends a DATABASE column unless the
 * name is taken. A value typed since the proposals arrived is therefore kept.
 */
export function applyProposals(
  columns: readonly DocumentationColumn[],
  proposals: readonly TypeProposal[],
  choices: Readonly<Record<string, { overwrite?: boolean }>> = {},
): DocumentationColumn[] {
  const result = columns.map((column) => ({ ...column }));
  for (const proposal of proposals) {
    const column = result.find((candidate) =>
      sameName(candidate.name, proposal.column),
    );
    if (proposal.change === "add") {
      if (column === undefined) {
        result.push({
          name: proposal.column,
          type: proposal.type,
          source: "DATABASE",
        });
      }
    } else if (column === undefined) {
      continue;
    } else if (proposal.change === "fill") {
      if (isBlank(column.type)) {
        column.type = proposal.type;
      }
    } else if (
      choices[proposal.column.toLowerCase()]?.overwrite === true &&
      sameName(column.type ?? "", proposal.current ?? "")
    ) {
      column.type = proposal.type;
      column.replaceType = true;
    }
  }
  return result;
}

/**
 * `columns` with description proposals applied. A proposal applies when it has exactly one candidate, or when `choices`
 * names one of its candidates by index (keyed by the lower-cased column name). Any other proposal is skipped, so an
 * accept-all without choices never picks between disagreeing ancestors. A description is set only where the column's
 * description is blank, so one typed since the proposals arrived is kept.
 */
export function applyDescriptionProposals(
  columns: readonly DocumentationColumn[],
  proposals: readonly DescriptionProposal[],
  choices: Readonly<Record<string, { candidate: number }>> = {},
): DocumentationColumn[] {
  const result = columns.map((column) => ({ ...column }));
  for (const proposal of proposals) {
    const column = result.find((candidate) =>
      sameName(candidate.name, proposal.column),
    );
    const picked =
      choices[proposal.column.toLowerCase()]?.candidate ??
      (proposal.candidates.length === 1 ? 0 : undefined);
    const description =
      picked === undefined
        ? undefined
        : proposal.candidates[picked]?.description;
    if (
      column !== undefined &&
      description !== undefined &&
      isBlank(column.description)
    ) {
      column.description = description;
    }
  }
  return result;
}
