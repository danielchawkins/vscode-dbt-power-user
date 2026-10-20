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

/** What `ColumnProposalService` answers with. Only the `types` kind exists so far. */
export type ColumnProposalsPayload = TypeProposalsPayload;

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

export const isColumnProposalsPayload = shape<ColumnProposalsPayload>({
  kind: oneOf("types"),
  model: isString,
  source: optional(isProposalSource),
  proposals: arrayOf(isTypeProposal),
  notFound: arrayOf(isString),
  notice: optional(isPanelNotice),
});

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
