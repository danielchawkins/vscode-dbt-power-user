import AppProvider from "@modules/app/AppProvider";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import QueryPanelProvider from "@modules/queryPanel/QueryPanelProvider";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll } from "vitest";
import type { ControlId } from "./controlCoverage";
import { getVsCodeApiMock } from "./setup";

/**
 * happy-dom lays nothing out, so the virtualizer would draw no rows. It sizes its scroll element from
 * `clientHeight` (`offsetHeight` before virtual-core 3.19.7), so both read a height on the grid's scroller and 0
 * elsewhere. Call it at the top level of a test file that renders the grid; its hooks then apply to that file.
 */
export const sizeGridsForVirtualizer = (): void => {
  const GRID_HEIGHT = 400;
  const SIZE_PROPERTIES = ["offsetHeight", "clientHeight"] as const;
  const originalSizes = SIZE_PROPERTIES.map(
    (name) =>
      [
        name,
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, name) ??
          Object.getOwnPropertyDescriptor(Element.prototype, name),
      ] as const,
  );

  beforeAll(() => {
    for (const name of SIZE_PROPERTIES) {
      Object.defineProperty(HTMLElement.prototype, name, {
        configurable: true,
        get(this: HTMLElement) {
          return this.getAttribute("role") === "grid" ? GRID_HEIGHT : 0;
        },
      });
    }
  });

  afterAll(() => {
    for (const [name, original] of originalSizes) {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, name, original);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          name
        ];
      }
    }
  });
};

/** Renders the panel inside the app, then dispatches each host message to it. */
export const openQueryPanel = (...messages: object[]) => {
  answerRequests();
  const user = userEvent.setup();
  const { container } = render(
    <AppProvider>
      <QueryPanelProvider />
    </AppProvider>,
  );
  for (const data of messages) {
    act(() => {
      globalThis.dispatchEvent(new MessageEvent("message", { data }));
    });
  }
  return { user, container };
};

const entry = (rawSql: string, timestamp: number) => ({
  rawSql,
  compiledSql: rawSql,
  timestamp,
  duration: 12,
  adapter: "snowflake",
  projectName: "demo",
  modelName: "stg_orders",
  columnNames: ["id"],
  columnTypes: ["number"],
  data: [{ id: 1 }],
});
/** Answers the sync requests the panel makes with no data, as the host does when it has none to give. */
const answerRequests = () =>
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { syncRequestId } = message as { syncRequestId?: string };
    if (syncRequestId) {
      queueMicrotask(() =>
        handleIncomingResponse({
          syncRequestId,
          status: true,
          body: undefined,
        }),
      );
    }
  });
/** Results with two rows, one of them JSON, so its cell gets the viewer button. */
export const RESULTS = {
  command: "renderQuery",
  columnNames: ["id", "name", "payload"],
  columnTypes: ["number", "string", "string"],
  rows: [
    { id: 1, name: "alpha", payload: '{"a": 1}' },
    { id: 2, name: "beta", payload: "short" },
  ],
  raw_sql: "select * from orders",
  compiled_sql: "select * from orders",
};
export const ERROR = {
  command: "renderError",
  error: {
    message: "Syntax error\nnear 'from'",
    code: 1,
    data: "compiler output",
  },
};
/** Two history entries, `select 1` first. */
export const HISTORY = {
  command: "queryHistory",
  args: {
    body: [
      entry("select 1", 1728000000000),
      entry("select * from orders", 1728000000001),
    ],
  },
};
/** Every control `QueryPanel.controls.test.tsx` clicks. */
export const TESTED_CONTROLS: readonly ControlId[] = [
  "button:History",
  "button:Welcome 🚀",
  "button:SQL",
  "button:Preview 0 rows",
  "button:Preview 2 rows",
  "button:open-adhoc-query",
  "button:Open in Tab",
  "button:Clear results",
  "button:Show materialized",
  "button:Show computed",
  "spinbutton:Limit",
  "button:Run query",
  "button:Save",
  "button:Export CSV",
  "button:Resize column id",
  "button:Resize column name",
  "button:Resize column payload",
  "button:View complete value",
  "button:payload/Close",
  "button:Cancel query",
  "link:Docs",
  "button:Copy to clipboard",
  "button:Search query",
  "button:select 1",
  "button:select * from orders",
  "button:Execute query",
  "button:Show results",
  "button:Open in editor",
  "button:+ New query",
];
