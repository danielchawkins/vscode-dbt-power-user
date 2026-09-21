import { render, waitFor } from "@testing-library/react";
import { UnknownAction } from "@reduxjs/toolkit";
import { Dispatch } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { getVsCodeApiMock } from "../../test/setup";
import * as requestExecutor from "./requestExecutor";
import useListeners from "./useListeners";

const Harness = ({
  dispatch,
}: {
  dispatch: Dispatch<UnknownAction>;
}): null => {
  useListeners(dispatch);
  return null;
};

describe("useListeners", () => {
  let dispatchMock: Mock<(action: UnknownAction) => void>;
  let dispatch: Dispatch<UnknownAction>;

  beforeEach(() => {
    dispatchMock = vi.fn<(action: UnknownAction) => void>();
    dispatch = dispatchMock;
    window.viewPath = "/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts webview:ready on mount", () => {
    render(<Harness dispatch={dispatch} />);

    expect(getVsCodeApiMock().postMessage).toHaveBeenCalledWith({
      command: "webview:ready",
    });
  });

  it("posts webview:ready for the docs-generator route", () => {
    window.viewPath = "/docs-generator";
    render(<Harness dispatch={dispatch} />);

    expect(getVsCodeApiMock().postMessage).toHaveBeenCalledWith({
      command: "webview:ready",
    });
  });

  it("dispatches credits updates from incoming messages", async () => {
    render(<Harness dispatch={dispatch} />);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "creditsUpdate",
          args: { availableExecutions: 42 },
        },
      }),
    );

    await waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "appState/setAvailableExecutions",
          payload: 42,
        }),
      );
    });
  });

  it("rejects non-finite credits values", async () => {
    render(<Harness dispatch={dispatch} />);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "creditsUpdate",
          args: { availableExecutions: Number.NaN },
        },
      }),
    );

    await waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "appState/setAvailableExecutions",
          payload: null,
        }),
      );
    });
  });

  it("forwards sync responses to the request executor", () => {
    const handleIncomingResponse = vi.spyOn(
      requestExecutor,
      "handleIncomingResponse",
    );
    render(<Harness dispatch={dispatch} />);

    const response = {
      syncRequestId: "req-1",
      body: { ok: true },
      status: true,
      error: "",
    };

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { command: "response", args: response },
      }),
    );

    expect(handleIncomingResponse).toHaveBeenCalledWith(response);
  });

  it("stops handling messages and theme mutations after unmount", async () => {
    const { unmount } = render(<Harness dispatch={dispatch} />);
    dispatchMock.mockClear();
    getVsCodeApiMock().postMessage.mockClear();

    unmount();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "creditsUpdate",
          args: { availableExecutions: 99 },
        },
      }),
    );

    document.body.classList.remove("vscode-dark");
    document.body.classList.add("vscode-light");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(dispatchMock).not.toHaveBeenCalled();
    expect(getVsCodeApiMock().postMessage).not.toHaveBeenCalled();
  });

  it("updates theme when body class changes", async () => {
    render(<Harness dispatch={dispatch} />);

    document.body.classList.remove("vscode-dark");
    document.body.classList.add("vscode-light");

    await waitFor(() => {
      expect(dispatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "appState/updateTheme",
          payload: "light",
        }),
      );
    });
  });
});
