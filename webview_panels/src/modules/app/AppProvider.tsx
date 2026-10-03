import { createContext, ReactNode, useMemo, useReducer } from "react";
import { appReducer, initialState } from "./appReducer";
import { ContextProps } from "./types";
import useListeners from "./useListeners";

export const AppContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});

const AppProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [state, dispatch] = useReducer(appReducer, initialState);

  useListeners(dispatch);

  const values = useMemo(
    () => ({
      state,
      dispatch,
    }),
    [state, dispatch],
  );

  return (
    <AppContext.Provider value={values}>
      <div className="App">{children}</div>
    </AppContext.Provider>
  );
};

export default AppProvider;
