import { render, waitFor } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/app/requestExecutor", () => ({
  executeRequestInSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./QueryPanel", () => ({
  default: (): null => null,
}));

import queryPanelSlice, { initialState } from "./context/queryPanelSlice";
import { QueryPanelContext } from "./QueryPanelProvider";
import useQueryPanelListeners from "./useQueryPanelListeners";
import useQueryPanelState from "./useQueryPanelState";

const HistoryProbe = ({
  onHistory,
}: {
  onHistory: (history: unknown) => void;
}): null => {
  const { queryHistory } = useQueryPanelState();
  onHistory(queryHistory);
  useQueryPanelListeners();
  return null;
};

const ProbeHarness = ({
  onHistory,
}: {
  onHistory: (history: unknown) => void;
}): JSX.Element => {
  const [state, dispatch] = useReducer(queryPanelSlice.reducer, initialState);

  return (
    <QueryPanelContext.Provider value={{ state, dispatch }}>
      <HistoryProbe onHistory={onHistory} />
    </QueryPanelContext.Provider>
  );
};

describe("useQueryPanelListeners", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies queryHistory messages to panel state", async () => {
    let latestHistory: unknown = initialState.queryHistory;
    const history = [
      {
        rawSql: "select 1",
        compiledSql: "select 1",
        timestamp: 1_728_000_000_000,
        duration: 12,
        adapter: "snowflake",
        projectName: "demo",
        modelName: "stg_orders",
      },
    ];

    render(
      <ProbeHarness
        onHistory={(historyValue) => {
          latestHistory = historyValue;
        }}
      />,
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "queryHistory",
          args: { body: history },
        },
      }),
    );

    await waitFor(() => {
      expect(latestHistory).toEqual(history);
    });
  });

  it("stops handling messages after unmount", async () => {
    let latestHistory: unknown = initialState.queryHistory;
    const { unmount } = render(
      <ProbeHarness
        onHistory={(historyValue) => {
          latestHistory = historyValue;
        }}
      />,
    );

    unmount();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          command: "queryHistory",
          args: {
            body: [
              {
                rawSql: "select 99",
                compiledSql: "select 99",
                timestamp: 1_728_000_000_001,
                duration: 8,
                adapter: "snowflake",
                projectName: "demo",
                modelName: "stg_orders",
              },
            ],
          },
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(latestHistory).toEqual(initialState.queryHistory);
  });
});
