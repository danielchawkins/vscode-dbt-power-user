import { act, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/queryPanel/requests", () => ({
  executeRequestInAsync: vi.fn(),
  executeRequestInSync: vi.fn().mockResolvedValue(undefined),
}));

import { QueryPanelContext } from "@modules/queryPanel/context/queryPanelContext";
import {
  initialState,
  queryPanelReducer,
  setActiveEditor,
} from "@modules/queryPanel/context/queryPanelReducer";
import { executeRequestInAsync } from "@modules/queryPanel/requests";
import QueryLimit from "./QueryLimit";

let dispatchRef: React.Dispatch<Parameters<typeof queryPanelReducer>[1]>;

const Harness = (): React.JSX.Element => {
  const [state, dispatch] = useReducer(queryPanelReducer, {
    ...initialState,
    limit: 500,
  });
  dispatchRef = dispatch;
  return (
    <QueryPanelContext.Provider value={{ state, dispatch }}>
      <QueryLimit />
    </QueryPanelContext.Provider>
  );
};

const input = (): HTMLInputElement =>
  screen.getByLabelText("Limit") as HTMLInputElement;
const type = (value: string): void => {
  fireEvent.change(input(), { target: { value } });
};

describe("QueryLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("offers no save while the value equals the saved limit", () => {
    render(<Harness />);
    expect(input().value).toBe("500");
    expect(screen.queryByText("Set as default")).toBeNull();
  });

  it("offers Save for a changed value, and hides it when the value returns", () => {
    render(<Harness />);
    type("100");
    expect(screen.getByText("Save")).toBeInTheDocument();
    type("500");
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("saves the limit, shows Saved for two seconds, then nothing", () => {
    render(<Harness />);
    type("100");
    fireEvent.click(screen.getByText("Save"));

    expect(executeRequestInAsync).toHaveBeenCalledWith("updateConfig", {
      limit: 100,
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Save")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("Saved")).toBeNull();
    expect(screen.queryByText("Set as default")).toBeNull();
  });

  it("shows Save for an edit made during the Saved window, and keeps it after the window", () => {
    render(<Harness />);
    type("100");
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    type("200");
    expect(screen.getByText("Save")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("resets the value when the active file changes", () => {
    render(<Harness />);
    type("100");
    act(() => {
      dispatchRef(setActiveEditor({ filepath: "/p/a.sql", query: "" }));
    });
    expect(input().value).toBe("500");
    expect(screen.queryByText("Save")).toBeNull();
  });
});
