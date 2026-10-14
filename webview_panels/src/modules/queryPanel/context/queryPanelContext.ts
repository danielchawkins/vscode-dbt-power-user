import { createContext, use } from "react";
import type { QueryPanelAction } from "./queryPanelReducer";
import { initialState } from "./queryPanelReducer";
import type { QueryPanelStateProps } from "./types";

interface ContextProps {
  state: QueryPanelStateProps;
  dispatch: React.Dispatch<QueryPanelAction>;
}

export const QueryPanelContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});

export const useQueryPanelDispatch = (): React.Dispatch<QueryPanelAction> => {
  const { dispatch } = use(QueryPanelContext);
  return dispatch;
};
