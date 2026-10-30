import type { lineage } from "@fusion-power-user/webview-contract";
import AppProvider from "@modules/app/AppProvider";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import LineageView from "@modules/lineage/LineageView";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, expect, vi } from "vitest";
import type { ControlId, InteractiveRole } from "./controlCoverage";
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

/** A model in `folder` of the root package, so the webview buckets it by that folder. */
const inFolder = (id: string, folder: string): lineage.LineageTable => ({
  ...table(id, "model", 1, 0),
  path: `${folder}/${id}.sql`,
  rootPackage: true,
});

/** The six children of `hub`, three in each of two folders. */
const HUB_CHILDREN = [
  inFolder("s1", "models/staging"),
  inFolder("s2", "models/staging"),
  inFolder("s3", "models/staging"),
  inFolder("m1", "models/marts"),
  inFolder("m2", "models/marts"),
  inFolder("m3", "models/marts"),
];

/** `hub` feeds `HUB_CHILDREN`; capped at two neighbours, its expansion draws them as one group per folder. */
export const HUB = table("hub", "model", 0, HUB_CHILDREN.length);

/** The folders of `FANOUT`, each holding two children, so that its expansion draws one group per folder. Name order, which is the order its chip row draws them in. */
export const FANOUT_GROUPS = ["alpha", "beta", "delta", "epsilon", "gamma"];

/** Two children in each of `FANOUT_GROUPS`; capped at five neighbours, its expansion draws five groups. */
const FANOUT_CHILDREN = FANOUT_GROUPS.flatMap((folder) =>
  [1, 2].map((n) => inFolder(`${folder}${n}`, `models/${folder}`)),
);

/** `fanout` feeds `FANOUT_CHILDREN`, more groups than the chip row draws inline. */
export const FANOUT = table("fanout", "model", 0, FANOUT_CHILDREN.length);

/** The ids of the children of `FANOUT`, in folder order. */
export const FANOUT_MEMBERS = FANOUT_CHILDREN.map((child) => child.table);

/** `filter` feeds `kept` and `audit`; `audit` sets `meta.lineage.hidden`, so it is drawn with no edge to or from it. */
export const FILTER = table("filter", "model", 0, 2);
const KEPT = table("kept", "model", 1, 0);
const AUDIT: lineage.LineageTable = {
  ...table("audit", "model", 1, 0),
  hidden: true,
};

const CHILDREN: Record<string, lineage.LineageTable[]> = {
  a: [TABLES.b],
  b: [TABLES.c],
  hub: HUB_CHILDREN,
  fanout: FANOUT_CHILDREN,
  filter: [KEPT, AUDIT],
};

const PARENTS: Record<string, lineage.LineageTable[]> = {
  b: [TABLES.a],
  c: [TABLES.b],
  ...Object.fromEntries(HUB_CHILDREN.map((child) => [child.table, [HUB]])),
  ...Object.fromEntries(
    FANOUT_CHILDREN.map((child) => [child.table, [FANOUT]]),
  ),
  kept: [FILTER],
  audit: [FILTER],
};

type Params = Record<string, unknown>;

/** The settings the host answers `getLineageSettings` with, as `openLineage` sets them. */
let hostSettings: Partial<lineage.LineageSettings> = {};

/** The relationships the host answers `getRelationships` with, as `openLineage` sets them. */
let hostRefs: lineage.LineageRef[] = [];

const ANSWERS: Record<string, (params: Params) => unknown> = {
  childTables: ({ table: t }) => ({ tables: CHILDREN[String(t)] ?? [] }),
  parentTables: ({ table: t }) => ({ tables: PARENTS[String(t)] ?? [] }),
  tableEdges: () => ({ edges: [] }),
  getColumns: ({ table: t }) => ({
    id: t,
    columns: [{ table: t, name: "id" }],
  }),
  getConnectedColumns: () => ({
    column_lineage: [
      { source: ["b", "id"], target: ["c", "id"], type: "direct" },
    ],
  }),
  getLineageSettings: () => hostSettings,
  persistLineageSettings: () => true,
  getRelationships: () => ({ refs: hostRefs }),
};

type Posted = {
  command: string;
  syncRequestId?: string;
  args?: { params?: Params };
};

/** Answers each sync request the panel posts as the host would; `held` requests wait until `release` is called. */
const answerRequests = (held: readonly string[] = []) => {
  const waiting: (() => void)[] = [];
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { command, syncRequestId, args } = message as Posted;
    if (syncRequestId) {
      const answer = () =>
        handleIncomingResponse({
          syncRequestId,
          status: true,
          body: ANSWERS[command]?.(args?.params ?? {}),
        });
      if (held.includes(command)) {
        waiting.push(answer);
      } else {
        queueMicrotask(answer);
      }
    }
  });
  return () => waiting.splice(0).forEach((answer) => answer());
};

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

/**
 * Renders the panel inside the app, and pushes `args` as the host's `render` message. `options.settings` is what the
 * host answers `getLineageSettings` with. `options.renderFirst` pushes the render before that answer lands, as a
 * slow host does.
 */
export const openLineage = async (
  args: lineage.RenderArgs = { node: TABLES.b, publication: "s:1" },
  options: {
    settings?: Partial<lineage.LineageSettings>;
    /** The relationships the host answers `getRelationships` with. */
    refs?: lineage.LineageRef[];
    renderFirst?: boolean;
    /** How many flow nodes the start table draws, its group cards included; 3 unless it has more groups. */
    flowNodes?: number;
  } = {},
): Promise<{ user: User; container: HTMLElement }> => {
  const release = answerRequests(
    options.renderFirst ? ["getLineageSettings"] : [],
  );
  hostSettings = options.settings ?? {};
  hostRefs = options.refs ?? [];
  const user = userEvent.setup();
  const { container } = render(
    <AppProvider>
      <LineageView />
    </AppProvider>,
  );
  // Lets the settings answer land first, so the graph is built with the cap the host sets.
  await act(async () => undefined);
  await act(async () => {
    globalThis.dispatchEvent(
      new MessageEvent("message", { data: { command: "render", args } }),
    );
  });
  await act(async () => release());
  if (args.node) {
    // Table cards and group cards are both React Flow nodes.
    await waitFor(() =>
      expect(flowNodes(container)).toHaveLength(options.flowNodes ?? 3),
    );
  }
  return { user, container };
};

/** The drawn nodes, table cards and group cards alike; the layer bands are not cards. */
export const flowNodes = (container: HTMLElement) =>
  container.querySelectorAll<HTMLElement>(
    ".react-flow__node:not(.react-flow__node-band)",
  );

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

/** The viewport's zoom, read from the React Flow transform. */
const viewportScale = (container: HTMLElement) =>
  Number(
    /scale\(([\d.]+)\)/.exec(
      container.querySelector<HTMLElement>(".react-flow__viewport")!.style
        .transform,
    )?.[1],
  );

/** Presses Zoom In or Zoom Out until the zoom is on the wanted side of 50%, where cards show only a badge and title. */
export const zoomPast = async (
  user: User,
  container: HTMLElement,
  direction: "In" | "Out",
): Promise<void> => {
  const done = () =>
    direction === "Out"
      ? viewportScale(container) < 0.5
      : viewportScale(container) >= 0.5;
  for (let step = 0; step < 12 && !done(); step++) {
    await activate(user, "button", `Zoom ${direction}`);
    await waitFor(() =>
      expect(Number.isFinite(viewportScale(container))).toBe(true),
    );
  }
  await waitFor(() => expect(done()).toBe(true));
};

afterEach(() => {
  getVsCodeApiMock().postMessage.mockReset();
  getVsCodeApiMock().getState.mockReset();
});
/** The controls `Lineage.controls.test.tsx` clicks, each by the id `collectControls` gives it. */
export const TESTED_CONTROLS: readonly ControlId[] = [
  "button:Settings",
  "spinbutton:Default expansion",
  "checkbox:Highlight the paths of the hovered or selected card",
  "checkbox:Dim the cards and edges off the path",
  "checkbox:Thin the edges of hub cards",
  "slider:Edge opacity 1.00",
  "checkbox:Show select (direct) column edges",
  "checkbox:Show non-select (indirect) column edges",
  "button:Connections",
  "radio:dbt dependencies",
  "radio:Declared relationships",
  "radio:Both",
  "checkbox:test",
  "checkbox:contract",
  "checkbox:meta",
  "checkbox:semantic",
  "checkbox:inferred",
  "slider:Inferred confidence ≥ 0.80",
  "checkbox:Infer relationships for sources",
  "button:Reset",
  "button:Help",
  "link:Help/Documentation",
  "button:Help/Close",
  "button:Help/backdrop Close",
  "button:Show minimap",
  "button:Hide minimap",
  "button:Zoom In",
  "button:Zoom Out",
  "button:Fit View",
  "button:table a/Show 0 parents",
  "button:table a/Show 1 children",
  "button:table a/Open file",
  "button:table a/Columns",
  "button:table a/Details",
  "button:table b/Hide 1 parents",
  "button:table b/Show 1 parents",
  "button:table b/Hide 1 children",
  "button:table b/Show 1 children",
  "button:table b/Open file",
  "button:table b/Columns",
  "button:table b/id",
  "button:table b/Details",
  "button:table c/Show 1 parents",
  "button:table c/Show 0 children",
  "button:table c/Columns",
  "button:table c/Details",
  "button:Open staging",
  "button:Open marts",
  "button:Open alpha",
  "button:Open beta",
  "button:Open gamma",
  "button:Open delta",
  "button:Open epsilon",
  "button:table fanout/Hide 10 children",
  "button:table fanout/Show 10 children",
  "button:table fanout/Show 0 parents",
  "button:table fanout/Columns",
  "button:table fanout/Details",
  "button:table fanout/+2 more",
  "button:table fanout/Close alpha",
  "button:table fanout/Close beta",
  "button:table fanout/Close delta",
  "button:Close epsilon",
  "button:Close gamma",
  "button:table alpha1/Show 1 parents",
  "button:table alpha1/Show 0 children",
  "button:table alpha1/Columns",
  "button:table alpha1/Details",
  "button:table alpha2/Show 1 parents",
  "button:table alpha2/Show 0 children",
  "button:table alpha2/Columns",
  "button:table alpha2/Details",
  "button:table beta1/Show 1 parents",
  "button:table beta1/Show 0 children",
  "button:table beta1/Columns",
  "button:table beta1/Details",
  "button:table beta2/Show 1 parents",
  "button:table beta2/Show 0 children",
  "button:table beta2/Columns",
  "button:table beta2/Details",
  "button:table gamma1/Show 1 parents",
  "button:table gamma1/Show 0 children",
  "button:table gamma1/Columns",
  "button:table gamma1/Details",
  "button:table gamma2/Show 1 parents",
  "button:table gamma2/Show 0 children",
  "button:table gamma2/Columns",
  "button:table gamma2/Details",
  "button:table delta1/Show 1 parents",
  "button:table delta1/Show 0 children",
  "button:table delta1/Columns",
  "button:table delta1/Details",
  "button:table delta2/Show 1 parents",
  "button:table delta2/Show 0 children",
  "button:table delta2/Columns",
  "button:table delta2/Details",
  "button:table epsilon1/Show 1 parents",
  "button:table epsilon1/Show 0 children",
  "button:table epsilon1/Columns",
  "button:table epsilon1/Details",
  "button:table epsilon2/Show 1 parents",
  "button:table epsilon2/Show 0 children",
  "button:table epsilon2/Columns",
  "button:table epsilon2/Details",
  "button:table hub/Hide 6 children",
  "button:table hub/Show 6 children",
  "button:table hub/Show 0 parents",
  "button:table hub/Columns",
  "button:table hub/Details",
  "button:table hub/Show 1 more in staging",
  "button:table hub/Close staging",
  "button:table s1/Columns",
  "button:table s1/Details",
  "button:table s1/Show 0 children",
  "button:table s1/Show 1 parents",
  "button:table s2/Columns",
  "button:table s2/Details",
  "button:table s2/Show 0 children",
  "button:table s2/Show 1 parents",
  "button:Details/Open file",
  "button:Details/Sync with database",
  "button:Details/Tests (0)",
  "button:Details/Meta",
  "button:Details/Columns (1)",
  "button:Details/Close",
  "button:Details/backdrop Close",
  "button:Click here",
  "button:Use strict analysis",
];
