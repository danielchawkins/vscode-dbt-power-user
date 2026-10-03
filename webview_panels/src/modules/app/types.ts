import type { AppAction } from "./appReducer";

export enum Themes {
  Dark = "dark",
  Light = "light",
}
export interface AppStateProps {
  theme: Themes;
}

export interface ContextProps {
  state: AppStateProps;
  dispatch: React.Dispatch<AppAction>;
}

