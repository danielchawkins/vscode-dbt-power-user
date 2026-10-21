import type { Dispatch } from "react";
import { createContext, use } from "react";
import type { ProposalsAction, ProposalsState } from "./proposalsReducer";
import { initialProposalsState } from "./proposalsReducer";

interface ProposalsContextProps {
  state: ProposalsState;
  dispatch: Dispatch<ProposalsAction>;
}

/** The pending column proposals. They sit beside `DocumentationContext`, so they never count as dirty. */
export const ProposalsContext = createContext<ProposalsContextProps>({
  state: initialProposalsState,
  dispatch: () => null,
});

export const useProposals = (): ProposalsContextProps => use(ProposalsContext);
