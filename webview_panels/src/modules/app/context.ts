import { createContext } from "react";
import { AppAction, initialState } from "./appReducer";
import { AppStateProps } from "./types";

export interface ContextProps {
  state: AppStateProps;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});
