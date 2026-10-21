import type { columnProposals } from "@fusion-power-user/webview-contract";
import { typedReducer } from "@modules/app/typedReducer";

/**
 * The choices for each kind's proposals, in the shape the contract's functions take: `applyProposals` reads the
 * overwrite tick of a types proposal, and `applyDescriptionProposals` reads the candidate index of a descriptions
 * proposal. A column with no pick has no entry. Keys are the lower-cased column name.
 */
export interface ProposalChoices {
  types: Record<string, { overwrite?: boolean }>;
  descriptions: Record<string, { candidate: number }>;
}

export type ProposalKind = keyof ProposalChoices;

type ProposalsEntries = {
  [K in ProposalKind]: {
    payload: Extract<columnProposals.ColumnProposalsPayload, { kind: K }>;
    choices: ProposalChoices[K];
  };
};

export interface ProposalsState {
  /** The model file the pending proposals were computed for. */
  model?: string | undefined;
  byKind: Partial<ProposalsEntries>;
}

export const initialProposalsState: ProposalsState = { byKind: {} };

/** The choices of both kinds, with a kind that has no proposals as empty. */
export const choicesOf = (state: ProposalsState): ProposalChoices => ({
  types: state.byKind.types?.choices ?? {},
  descriptions: state.byKind.descriptions?.choices ?? {},
});

const keyOf = (column: string): string => column.toLowerCase();

type ProposalOf<K extends ProposalKind> =
  ProposalsEntries[K]["payload"]["proposals"][number];

/** Keeps the proposals of `kind` that `keep` accepts; the kind's other fields are unchanged. */
const filterKind = <K extends ProposalKind>(
  state: ProposalsState,
  kind: K,
  keep: (proposal: ProposalOf<K>) => boolean,
): ProposalsState => {
  const entry = state.byKind[kind];
  return entry
    ? {
        ...state,
        byKind: {
          ...state.byKind,
          [kind]: {
            ...entry,
            payload: {
              ...entry.payload,
              proposals: entry.payload.proposals.filter(keep),
            },
          },
        },
      }
    : state;
};

/** Removes the one proposal of `column` from `kind`'s pending list. */
const removeOne = (
  state: ProposalsState,
  { kind, column }: { kind: ProposalKind; column: string },
): ProposalsState => filterKind(state, kind, (p) => p.column !== column);

const proposals = typedReducer<
  ProposalsState,
  {
    received: columnProposals.ColumnProposalsPayload;
    cleared: void;
    accepted: { kind: ProposalKind; column: string };
    skipped: { kind: ProposalKind; column: string };
    acceptedAll: void;
    chose: { column: string; candidate: number };
    toggledOverwrite: { column: string };
    dismissed: { kind: ProposalKind };
  }
>({
  // Replaces the proposals of the payload's kind only; no candidate or overwrite is chosen yet.
  received: (state, payload) => ({
    model: payload.model,
    byKind:
      payload.kind === "types"
        ? { ...state.byKind, types: { payload, choices: {} } }
        : { ...state.byKind, descriptions: { payload, choices: {} } },
  }),
  cleared: () => initialProposalsState,
  // Applying a proposal and skipping one both take it out of the pending list; only the apply changes the editor.
  accepted: removeOne,
  skipped: removeOne,
  // Leaves pending what accept-all does not apply: an overwrite without its tick, and a description with several
  // candidates and no pick. `applyProposals` and `applyDescriptionProposals` apply the rest. The contract exports no
  // predicate for this, so the rule is stated here.
  acceptedAll: (state) => {
    const choices = choicesOf(state);
    const typesPending = filterKind(
      state,
      "types",
      (p) =>
        p.change === "overwrite" &&
        choices.types[keyOf(p.column)]?.overwrite !== true,
    );
    return filterKind(
      typesPending,
      "descriptions",
      (p) =>
        p.candidates.length > 1 &&
        choices.descriptions[keyOf(p.column)] === undefined,
    );
  },
  chose: (state, { column, candidate }) => {
    const entry = state.byKind.descriptions;
    return entry
      ? {
          ...state,
          byKind: {
            ...state.byKind,
            descriptions: {
              ...entry,
              choices: {
                ...entry.choices,
                [keyOf(column)]: { candidate },
              },
            },
          },
        }
      : state;
  },
  toggledOverwrite: (state, { column }) => {
    const entry = state.byKind.types;
    const key = keyOf(column);
    return entry
      ? {
          ...state,
          byKind: {
            ...state.byKind,
            types: {
              ...entry,
              choices: {
                ...entry.choices,
                [key]: { overwrite: !entry.choices[key]?.overwrite },
              },
            },
          },
        }
      : state;
  },
  // Drops the kind's whole entry, its proposals and its picks.
  dismissed: (state, { kind }) => {
    const byKind = { ...state.byKind };
    if (kind === "types") {
      delete byKind.types;
    } else {
      delete byKind.descriptions;
    }
    return { ...state, byKind };
  },
});

export const proposalsReducer = proposals.reducer;
export type ProposalsAction = Parameters<typeof proposalsReducer>[1];
export const {
  received,
  cleared,
  accepted,
  skipped,
  acceptedAll,
  chose,
  toggledOverwrite,
  dismissed,
} = proposals.actions;
