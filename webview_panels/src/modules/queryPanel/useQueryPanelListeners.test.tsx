import { executeRequestInSync } from "@modules/queryPanel/requests";
import { render, waitFor } from "@testing-library/react";
import { useReducer } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@modules/queryPanel/requests", () => ({
  executeRequestInAsync: vi.fn(),
  executeRequestInSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./QueryPanel", () => ({
  default: (): null => null,
}));

import { QueryPanelContext } from "./context/queryPanelContext";
import { initialState, queryPanelReducer } from "./context/queryPanelReducer";
import type { QueryPanelStateProps } from "./context/types";
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
}): React.JSX.Element => {
  const [state, dispatch] = useReducer(queryPanelReducer, initialState);

  return (
    <QueryPanelContext value={{ state, dispatch }}>
      <HistoryProbe onHistory={onHistory} />
    </QueryPanelContext>
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

    globalThis.dispatchEvent(
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

    globalThis.dispatchEvent(
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

  describe("a results tab opened from history", () => {
    const ElapsedProbe = ({
      onState,
    }: {
      onState: (state: QueryPanelStateProps) => void;
    }): null => {
      onState(useQueryPanelState());
      useQueryPanelListeners();
      return null;
    };

    const ElapsedHarness = ({
      onState,
    }: {
      onState: (state: QueryPanelStateProps) => void;
    }): React.JSX.Element => {
      const [state, dispatch] = useReducer(queryPanelReducer, initialState);

      return (
        <QueryPanelContext value={{ state, dispatch }}>
          <ElapsedProbe onState={onState} />
        </QueryPanelContext>
      );
    };

    it("shows the rows and the elapsed time from the tab data", async () => {
      // The body tabDataOf sends for a history entry (src/features/queryResults/queryPanelSupport.ts).
      vi.mocked(executeRequestInSync).mockResolvedValueOnce({
        queryResults: {
          data: [{ id: 1 }],
          columnNames: ["id"],
          columnTypes: ["NUMBER"],
        },
        compiledCodeMarkup: "select * from analytics.orders",
        rawSql: "select * from orders",
        queryExecutionInfo: { elapsedTime: 2.5 },
      });
      let latest: QueryPanelStateProps | undefined;

      render(
        <ElapsedHarness
          onState={(state) => {
            latest = state;
          }}
        />,
      );

      await waitFor(() => {
        expect(latest?.queryExecutionInfo?.elapsedTime).toBe(2.5);
      });
      expect(latest?.queryResults?.data).toEqual([{ id: 1 }]);
    });

    it("renders the rows and leaves the time unset when the tab data has none", async () => {
      vi.mocked(executeRequestInSync).mockResolvedValueOnce({
        queryResults: {
          data: [{ id: 1 }],
          columnNames: ["id"],
          columnTypes: ["NUMBER"],
        },
        compiledCodeMarkup: "select * from analytics.orders",
      });
      let latest: QueryPanelStateProps | undefined;

      render(
        <ElapsedHarness
          onState={(state) => {
            latest = state;
          }}
        />,
      );

      await waitFor(() => {
        expect(latest?.queryResults?.data).toEqual([{ id: 1 }]);
      });
      expect(latest?.queryExecutionInfo).toBeUndefined();
    });
  });
});
