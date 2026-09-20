import { panelLogger } from "@modules/logger";
import { UnknownAction } from "@reduxjs/toolkit";
import { Dispatch, useCallback, useEffect } from "react";
import {
  setAvailableExecutions,
  setTenantInfo,
  updateTheme,
} from "./appSlice";
import {
  executeRequestInAsync,
  executeRequestInSync,
  handleIncomingResponse,
} from "./requestExecutor";
import {
  AppStateProps,
  IncomingMessageProps,
  IncomingSyncResponse,
  Themes,
} from "./types";

const useListeners = (dispatch: Dispatch<UnknownAction>): void => {
  const onMesssage = useCallback(
    (event: MessageEvent<IncomingMessageProps>) => {
      const { command, args } = event.data;
      switch (command) {
        case "response":
          handleIncomingResponse(args as unknown as IncomingSyncResponse);
          break;
        case "creditsUpdate":
          dispatch(
            setAvailableExecutions(
              // `Number.isFinite` rejects NaN (which passes `typeof === "number"`
              // and would render "NaN credits"); `typeof` stays to narrow the type.
              typeof args.availableExecutions === "number" &&
                Number.isFinite(args.availableExecutions)
                ? args.availableExecutions
                : null,
            ),
          );
          break;
        default:
          break;
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

  const loadTenantInfo = () => {
    executeRequestInSync("fetch", {
      endpoint: "auth/tenant-info",
      fetchArgs: { method: "GET" },
    })
      .then((data) => {
        panelLogger.log("loadTenantInfo", data);
        dispatch(setTenantInfo(data as AppStateProps["tenantInfo"]));
      })
      .catch((err) =>
        panelLogger.error("error while fetching tenant info", err),
      );
  };

  useEffect(() => {
    window.addEventListener("message", onMesssage);

    if (window.viewPath !== "/docs-generator") {
      executeRequestInAsync("webview:ready", {});
      loadTenantInfo();
    }
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
