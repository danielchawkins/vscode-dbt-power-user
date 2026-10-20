import type { columnProposals } from "@fusion-power-user/webview-contract";
import { typedReducer } from "@modules/app/typedReducer";

/**
 * The choices for each kind's proposals, in the shape the contract's functions take: `applyProposals` reads the
 * overwrite tick of a types proposal, and `applyDescriptionProposals` reads the candidate index of a descriptions
 * proposal. A column with no pick has no entry. Keys are the lower-cased column name.
 */
interface ProposalChoices {
  types: Record<string, { overwrite?: boolean }>;
  descriptions: Record<string, { candidate: number }>;
}

type ProposalsEntries = {
  [K in keyof ProposalChoices]: {
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

const proposals = typedReducer<
  ProposalsState,
  {
    received: columnProposals.ColumnProposalsPayload;
    cleared: void;
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
});

export const proposalsReducer = proposals.reducer;
export type ProposalsAction = Parameters<typeof proposalsReducer>[1];
export const { received, cleared } = proposals.actions;
