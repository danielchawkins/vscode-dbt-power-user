import { createContext } from "react";
import type { AppAction } from "./appReducer";
import { initialState } from "./appReducer";
import type { AppStateProps } from "./types";

export interface ContextProps {
  state: AppStateProps;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});
