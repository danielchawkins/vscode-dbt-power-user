import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { AppStateProps, Themes } from "./types";

export const initialState = {
  theme: Themes.Dark,
  isComponentsApiInitialized: false,
  availableExecutions: null,
  tenantInfo: {
    frontendUrl: null,
    currency: "USD",
    // This is tenant level global setting
    teammatesEnabled: false,
  },
} as AppStateProps;

const appSlice = createSlice({
  name: "appState",
  initialState,
  reducers: {
    setTenantInfo: (
      state,
      action: PayloadAction<AppStateProps["tenantInfo"]>,
    ) => {
      state.tenantInfo = action.payload;
    },
    updateTheme: (state, action: PayloadAction<Themes>) => {
      state.theme = action.payload;
    },
    updateIsComponentsApiInitialized: (
      state,
      action: PayloadAction<boolean>,
    ) => {
      state.isComponentsApiInitialized = action.payload;
    },
    setAvailableExecutions: (state, action: PayloadAction<number | null>) => {
      state.availableExecutions = action.payload;
    },
  },
});

export const {
  updateTheme,
  updateIsComponentsApiInitialized,
  setTenantInfo,
  setAvailableExecutions,
} = appSlice.actions;
export default appSlice;
