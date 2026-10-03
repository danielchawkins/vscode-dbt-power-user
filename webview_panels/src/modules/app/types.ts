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

export interface User {
  display_name: string;
  first_name: string;
  last_name: string;
  id: number;
}
