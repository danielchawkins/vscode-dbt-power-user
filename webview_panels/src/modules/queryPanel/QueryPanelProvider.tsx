import { createContext, useContext, useMemo, useReducer } from "react";
import QueryPanel from "./QueryPanel";
import {
  initialState,
  QueryPanelAction,
  queryPanelReducer,
} from "./context/queryPanelReducer";
import { QueryPanelStateProps } from "./context/types";

interface ContextProps {
  state: QueryPanelStateProps;
  dispatch: React.Dispatch<QueryPanelAction>;
}

export const QueryPanelContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});

const QueryPanelProvider = (): JSX.Element => {
  const [state, dispatch] = useReducer(queryPanelReducer, initialState);

  const values = useMemo(
    () => ({
      state,
      dispatch,
    }),
    [state, dispatch],
  );

  return (
    <QueryPanelContext.Provider value={values}>
      <QueryPanel />
    </QueryPanelContext.Provider>
  );
};

export default QueryPanelProvider;

export const useQueryPanelDispatch = (): React.Dispatch<QueryPanelAction> => {
  const { dispatch } = useContext(QueryPanelContext);
  return dispatch;
};
