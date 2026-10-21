import { applyColumnProposals } from "@modules/documentationEditor/state/documentationReducer";
import useDocumentationContext from "@modules/documentationEditor/state/useDocumentationContext";
import { useProposals } from "./ProposalsContext";
import type { ProposalKind } from "./proposalsReducer";
import {
  acceptedAll,
  accepted,
  choicesOf,
  dismissed,
  skipped,
} from "./proposalsReducer";

/**
 * The ways a user settles pending proposals. Accepting applies to the editor's columns and then takes the proposal
 * out of the pending list; skipping only takes it out; accept-all applies what it can.
 */
export interface ProposalActions {
  accept: (kind: ProposalKind, column: string) => void;
  skip: (kind: ProposalKind, column: string) => void;
  acceptAll: () => void;
  dismiss: () => void;
}

export const useProposalActions = (): ProposalActions => {
  const { state, dispatch } = useProposals();
  const { dispatch: dispatchDocumentation } = useDocumentationContext();
  const choices = choicesOf(state);
  const types = state.byKind.types?.payload.proposals ?? [];
  const descriptions = state.byKind.descriptions?.payload.proposals ?? [];

  return {
    accept: (kind: ProposalKind, column: string) => {
      dispatchDocumentation(
        applyColumnProposals({
          proposals:
            kind === "types"
              ? {
                  types: types.filter((p) => p.column === column),
                  descriptions: [],
                }
              : {
                  types: [],
                  descriptions: descriptions.filter((p) => p.column === column),
                },
          choices,
        }),
      );
      dispatch(accepted({ kind, column }));
    },
    skip: (kind: ProposalKind, column: string) =>
      dispatch(skipped({ kind, column })),
    acceptAll: () => {
      dispatchDocumentation(
        applyColumnProposals({ proposals: { types, descriptions }, choices }),
      );
      dispatch(acceptedAll());
    },
    dismiss: () => {
      if (state.byKind.types) {
        dispatch(dismissed({ kind: "types" }));
      }
      if (state.byKind.descriptions) {
        dispatch(dismissed({ kind: "descriptions" }));
      }
    },
  };
};
