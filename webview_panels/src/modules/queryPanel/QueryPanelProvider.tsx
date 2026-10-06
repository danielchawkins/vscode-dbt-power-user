import { useMemo, useReducer } from "react";
import QueryPanel from "./QueryPanel";
import { QueryPanelContext } from "./context/queryPanelContext";
import { initialState, queryPanelReducer } from "./context/queryPanelReducer";

const QueryPanelProvider = (): React.JSX.Element => {
  const [state, dispatch] = useReducer(queryPanelReducer, initialState);

  const values = useMemo(
    () => ({
      state,
      dispatch,
    }),
    [state, dispatch],
  );

  return (
    <QueryPanelContext value={values}>
      <QueryPanel />
    </QueryPanelContext>
  );
};

export default QueryPanelProvider;
