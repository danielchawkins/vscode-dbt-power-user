import { createContext } from "react";
import { initialState } from "./state/documentationReducer";
import { ContextProps } from "./types";

export const DocumentationContext = createContext<ContextProps>({
  state: initialState,
  dispatch: () => null,
});
