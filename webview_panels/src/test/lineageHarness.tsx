import type { lineage } from "@fusion-power-user/webview-contract";
import AppProvider from "@modules/app/AppProvider";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import LineageView from "@modules/lineage/LineageView";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import type { InteractiveRole } from "./controlCoverage";
import { getVsCodeApiMock } from "./setup";

/**
 * Shared by the Lineage controls suite and its coverage gate. Importing this module
 * registers the happy-dom shims React Flow needs and the per-test mock reset.
 */

// ---- happy-dom shims React Flow needs: observed sizes, element sizes and a DOMMatrix ----

/** The size every observed element reports; the canvas is below the size that shows the minimap. */
const CANVAS = { width: 600, height: 400 };
const NODE = { width: 200, height: 100 };

class FakeResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element): void {
    const size = target.classList.contains("react-flow__node") ? NODE : CANVAS;
    this.callback([{ target, contentRect: size } as ResizeObserverEntry], this);
  }
  unobserve(): void {}
  disconnect(): void {}
}

class FakeDOMMatrix {
  m22 = 1;
  public readonly transform: string | undefined;

  constructor(transform?: string) {
    this.transform = transform;
    const scale = /scale\(([\d.]+)\)/.exec(transform ?? "");
    this.m22 = scale ? Number(scale[1]) : 1;
  }
}

const sizeGetter = (axis: "width" | "height") =>
  function (this: HTMLElement) {
    return this.classList.contains("react-flow__node")
      ? NODE[axis]
      : CANVAS[axis];
  };

/** user-event's mouse events carry no `view`, which d3-zoom's drag handling reads; give them the window. */
const MOUSE_EVENTS = ["mousedown", "mousemove", "mouseup", "dblclick", "wheel"];
const giveView = (event: Event) => {
  if (!(event as UIEvent).view) {
    Object.defineProperty(event, "view", { value: globalThis });
  }
};

const elementSizes = [
  ["offsetWidth", sizeGetter("width")],
  ["offsetHeight", sizeGetter("height")],
] as const;

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("DOMMatrixReadOnly", FakeDOMMatrix);
  for (const type of MOUSE_EVENTS) {
    globalThis.addEventListener(type, giveView, true);
  }
  for (const [name, get] of elementSizes) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get,
    });
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const type of MOUSE_EVENTS) {
    globalThis.removeEventListener(type, giveView, true);
  }
  for (const [name] of elementSizes) {
    Reflect.deleteProperty(HTMLElement.prototype, name);
  }
});

// ---- the host's side ----

const table = (
  id: string,
  nodeType: string,
  parentCount: number,
  childCount: number,
  url?: string,
): lineage.LineageTable => ({
  table: id,
  label: id,
  nodeType,
  parentCount,
  childCount,
  tests: [],
  ...(url ? { url } : {}),
});

/** `a` (a source) feeds `b`, the start table, which feeds `c`. */
const TABLES = {
  a: table("a", "source", 0, 1, "models/schema.yml"),
  b: table("b", "model", 1, 1, "models/b.sql"),
  c: table("c", "model", 1, 0),
};

type Params = Record<string, unknown>;

const ANSWERS: Record<string, (params: Params) => unknown> = {
  childTables: ({ table: t }) => ({
    tables: t === "a" ? [TABLES.b] : t === "b" ? [TABLES.c] : [],
  }),
  parentTables: ({ table: t }) => ({
    tables: t === "b" ? [TABLES.a] : t === "c" ? [TABLES.b] : [],
  }),
  getColumns: ({ table: t }) => ({
    id: t,
    columns: [{ table: t, name: "id" }],
  }),
  getConnectedColumns: () => ({
    column_lineage: [
      { source: ["b", "id"], target: ["c", "id"], type: "direct" },
    ],
  }),
  getLineageSettings: () => ({}),
  persistLineageSettings: () => true,
  getRelationships: () => ({ refs: [] }),
};

type Posted = {
  command: string;
  syncRequestId?: string;
  args?: { params?: Params };
};

/** Answers each sync request the panel posts as the host would. */
const answerRequests = () =>
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { command, syncRequestId, args } = message as Posted;
    if (syncRequestId) {
      queueMicrotask(() =>
        handleIncomingResponse({
          syncRequestId,
          status: true,
          body: ANSWERS[command]?.(args?.params ?? {}),
        }),
      );
    }
  });

export const commands = (name: string) =>
  getVsCodeApiMock().postMessage.mock.calls.filter(
    ([m]) => (m as Posted).command === name,
  );

/** The empty state: no table to draw, and a notice with the buttons the host gave it. */
export const EMPTY_STATE: lineage.RenderArgs = {
  missingLineageMessage: {
    message: "Lineage needs a compiled project.",
    type: "error",
    actions: [{ title: "Use strict analysis", action: "useStrictAnalysis" }],
  },
};

export type User = ReturnType<typeof userEvent.setup>;

/** Renders the panel inside the app, and pushes `args` as the host's `render` message. */
export const openLineage = async (
  args: lineage.RenderArgs = { node: TABLES.b, publication: "s:1" },
): Promise<{ user: User; container: HTMLElement }> => {
  answerRequests();
  const user = userEvent.setup();
  const { container } = render(
    <AppProvider>
      <LineageView />
    </AppProvider>,
  );
  await act(async () => {
    globalThis.dispatchEvent(
      new MessageEvent("message", { data: { command: "render", args } }),
    );
  });
  if (args.node) {
    await waitFor(() => expect(nodes(container)).toHaveLength(3));
  }
  return { user, container };
};

export const nodes = (container: HTMLElement) =>
  container.querySelectorAll<HTMLElement>("[data-table]");

/** The node of table `id`. */
export const node = (container: HTMLElement, id: string) =>
  within(container.querySelector<HTMLElement>(`[data-table="${id}"]`)!);

export const pane = (container: HTMLElement) =>
  container.querySelector<HTMLElement>(".react-flow__pane")!;

/** The drawn tables, sorted. */
export const tableIds = (container: HTMLElement) =>
  Array.from(nodes(container), (n) => n.dataset.table).sort((a, b) =>
    a! < b! ? -1 : a! > b! ? 1 : 0,
  );

export type Scope = { getByRole: typeof screen.getByRole };

/** Clicks the control, as a user does, without counting it as tested; for reaching a state. */
export const activate = async (
  user: User,
  role: InteractiveRole,
  name: string,
  scope: Scope = screen,
): Promise<HTMLElement> => {
  const element = scope.getByRole(role, { name });
  await user.click(element);
  return element;
};

afterEach(() => {
  getVsCodeApiMock().postMessage.mockReset();
  getVsCodeApiMock().getState.mockReset();
});
