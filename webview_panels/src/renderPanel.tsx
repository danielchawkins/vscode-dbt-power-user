import AppProvider from "@modules/app/AppProvider";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "./main.css";

/** Mounts one panel's root component with the providers and styles every panel shares. */
export const renderPanel = (panel: React.JSX.Element): void => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppProvider>{panel}</AppProvider>
    </StrictMode>,
  );
};
