import type {
  Response,
  WebviewReady,
} from "@fusion-power-user/webview-contract";
import { panelLogger } from "@modules/logger";
import { UnknownAction } from "@reduxjs/toolkit";
import { Dispatch, useCallback, useEffect } from "react";
import { updateTheme } from "./appSlice";
import { handleIncomingResponse, panelRequests } from "./requestExecutor";
import { Themes } from "./types";

// Every panel's union includes `webview:ready`.
const { executeRequestInAsync } = panelRequests<WebviewReady>();

const useListeners = (dispatch: Dispatch<UnknownAction>): void => {
  const onMesssage = useCallback(
    (event: MessageEvent<Response | { command?: undefined }>) => {
      if (event.data.command === "response") {
        handleIncomingResponse(event.data.args);
      }
    },
    [],
  );

  const isDark = (element: HTMLElement) => {
    const classList = element.classList;
    if (classList.contains("vscode-dark")) {
      return true;
    }

    if (classList.contains("vscode-high-contrast-light")) {
      return false;
    }

    if (classList.contains("vscode-high-contrast")) {
      return true;
    }

    return false;
  };
  const setTheme = (element: HTMLElement) => {
    dispatch(updateTheme(isDark(element) ? Themes.Dark : Themes.Light));
  };

  useEffect(() => {
    window.addEventListener("message", onMesssage);
    executeRequestInAsync("webview:ready");

    const themeObserver = new MutationObserver((mutations) => {
      mutations.forEach((mu) => {
        panelLogger.debug("body classname modified!", mu);
        setTheme(mu.target as HTMLElement);
      });
    });

    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
    setTheme(document.body);

    return () => {
      window.removeEventListener("message", onMesssage);
      themeObserver.disconnect();
    };
  }, [onMesssage]);
};

export default useListeners;
