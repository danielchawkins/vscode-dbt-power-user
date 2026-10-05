import { createContext, useContext } from "react";
import { initialState, QueryPanelAction } from "./queryPanelReducer";
import { QueryPanelStateProps } from "./types";

interface ContextProps {
  state: QueryPanelStateProps;
  dispatch: React.Dispatch<QueryPanelAction>;
}

export const QueryPanelContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});

export const useQueryPanelDispatch = (): React.Dispatch<QueryPanelAction> => {
  const { dispatch } = useContext(QueryPanelContext);
  return dispatch;
};
