import { typedReducer } from "./typedReducer";
import { AppStateProps, Themes } from "./types";

export const initialState: AppStateProps = {
  theme: Themes.Dark,
};

const app = typedReducer<AppStateProps, { updateTheme: Themes }>({
  updateTheme: (state, theme) => ({ ...state, theme }),
});

export const appReducer = app.reducer;
export const { updateTheme } = app.actions;
export type AppAction = Parameters<typeof appReducer>[1];
