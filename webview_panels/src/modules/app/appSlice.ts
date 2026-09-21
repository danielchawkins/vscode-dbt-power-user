import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { AppStateProps, Themes } from "./types";

export const initialState = {
  theme: Themes.Dark,
  availableExecutions: null,
} as AppStateProps;

const appSlice = createSlice({
  name: "appState",
  initialState,
  reducers: {
    updateTheme: (state, action: PayloadAction<Themes>) => {
      state.theme = action.payload;
    },
    setAvailableExecutions: (state, action: PayloadAction<number | null>) => {
      state.availableExecutions = action.payload;
    },
  },
});

export const { updateTheme, setAvailableExecutions } = appSlice.actions;
export default appSlice;
