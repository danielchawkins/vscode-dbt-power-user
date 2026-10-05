import { useMemo, useReducer } from "react";
import QueryPanel from "./QueryPanel";
import { QueryPanelContext } from "./context/queryPanelContext";
import { initialState, queryPanelReducer } from "./context/queryPanelReducer";

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
