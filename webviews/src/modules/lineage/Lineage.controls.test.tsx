import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectPosted } from "../../test/controlCoverage";
import { controlRecorder } from "../../test/controlRecorder";
import { fits } from "../../test/fitRecorder";
import {
  activate,
  commands,
  EMPTY_STATE,
  FANOUT,
  FANOUT_GROUPS,
  FANOUT_MEMBERS,
  FILTER,
  WIDE,
  flowNodes,
  HUB,
  HUB_CHILDREN,
  node,
  nodes,
  openLineage,
  pane,
  PROJECT_IDS,
  tableIds,
  TESTED_CONTROLS,
  type User,
  zoomPast,
} from "../../test/lineageHarness";
import { getVsCodeApiMock } from "../../test/setup";
import type * as CardControls from "./cardControls";
import { engineFor } from "./engine/engines";
import { resolveSettings } from "./viewModel";

vi.mock("./fit", async (importOriginal) =>
  (await import("../../test/fitRecorder")).recordingFit(importOriginal),
);

/** The switch the card controls read; a test sets it to the value it checks, and the default is the production one. */
const controlClicks = vi.hoisted(() => ({ selects: true }));
vi.mock("./cardControls", async (importOriginal) => ({
  ...(await importOriginal<typeof CardControls>()),
  get CONTROL_CLICK_SELECTS_CARD() {
    return controlClicks.selects;
  },
}));

const { clicked, press, pressElement, typeInto } = controlRecorder();

/** The backdrop of the drawer labelled `label`: the button the drawer renders just before its `aside`. */
const backdropOf = (label: string) =>
  screen
    .getAllByRole("button", { name: "Close" })
    .find((button) =>
      button.nextElementSibling?.matches(`aside[aria-label="${label}"]`),
    )!;

const drawer = (name: string) =>
  within(screen.getByRole("complementary", { name }));

/** The two views the scope suites run in: the whole project, and the neighbourhood the other tests were written for. */
const MODES = ["whole", "neighbourhood"] as const;
type Mode = (typeof MODES)[number];

/**
 * The table IDs a view draws in `mode` for the neighbourhood `ids`. The whole project draws every fixture table, so
 * its cards are all of them whatever the neighbourhood is.
 */
const drawnIn = (mode: Mode, ids: string[]): string[] =>
  mode === "whole" ? PROJECT_IDS.toSorted() : ids.toSorted();

/** The whole project without the cards `ids`: what the whole-project view draws once they are hidden. */
const projectWithout = (...ids: string[]): string[] =>
  PROJECT_IDS.filter((id) => !ids.includes(id)).toSorted();

/**
 * The edges the whole project thins with a cap of one: every edge of `hub` (six), of `fanout` (ten), of `filter`
 * (one drawn, to `kept`) and of `wide` (three). `a`, `b` and `c` have no hub end.
 */
const WHOLE_HUB_EDGES = 20;

// ---- the tests ----

describe("Lineage Settings popover", () => {
  it("opens, shows the edge settings and toggles each edge checkbox", async () => {
    const { user } = await openLineage();
    const gear = await press(user, "button", "Settings");
    expect(gear).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const direct = await press(
      user,
      "checkbox",
      "Show select (direct) column edges",
    );
    expect(direct).not.toBeChecked();
    await expectPosted("persistLineageSettings", {
      args: { params: { showSelectEdges: false } },
    });

    const indirect = await press(
      user,
      "checkbox",
      "Show non-select (indirect) column edges",
    );
    expect(indirect).toBeChecked();
    await expectPosted("persistLineageSettings", {
      args: { params: { showNonSelectEdges: true } },
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on a click on the pane and leaves the gear collapsed", async () => {
    const { user, container } = await openLineage();
    const gear = await activate(user, "button", "Settings");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(pane(container));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gear).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a click on a layer band, which takes no pointer events", async () => {
    const { user, container } = await openLineage();
    const gear = await activate(user, "button", "Settings");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const band = container.querySelector<HTMLElement>(".react-flow__node-band");
    expect(band).not.toBeNull();
    expect(band?.style.pointerEvents).toBe("none");
    // user-event refuses to click an element with pointer-events: none, which a band is by design. This user skips
    // that check; the press still reaches the document, where the popover's outside-press listener closes it.
    await userEvent.setup({ pointerEventsCheck: 0 }).click(band!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gear).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on a second click on the gear and leaves it collapsed", async () => {
    const { user } = await openLineage();
    const gear = await activate(user, "button", "Settings");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(gear);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gear).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and leaves the gear collapsed", async () => {
    const { user } = await openLineage();
    const gear = await activate(user, "button", "Settings");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gear).toHaveAttribute("aria-expanded", "false");
  });

  it("sets the default expansion from its number input", async () => {
    const { user } = await openLineage();
    await press(user, "button", "Settings");
    await press(user, "radio", "Whole project");
    const expansion = await typeInto(
      user,
      "spinbutton",
      "Default expansion",
      "3",
    );
    expect(expansion).toHaveValue(3);
    await expectPosted("persistLineageSettings", {
      args: { params: { defaultExpansion: 3 } },
    });
  });
});

describe("Lineage view controls", () => {
  it("shows Default expansion only in the whole project, and switches the view both ways", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Settings");
    expect(
      screen.queryByRole("spinbutton", { name: "Default expansion" }),
    ).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: "Upstream depth" }),
    ).toHaveValue(2);
    await press(user, "radio", "Whole project");
    await expectPosted("persistLineageSettings", {
      args: { params: { viewMode: "whole" } },
    });
    expect(
      screen.getByRole("spinbutton", { name: "Default expansion" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("spinbutton", { name: "Upstream depth" }),
    ).toBeNull();
    await waitFor(() =>
      expect(tableIds(container)).toEqual(PROJECT_IDS.toSorted()),
    );
    await press(user, "radio", "Neighbourhood");
    await expectPosted("persistLineageSettings", {
      args: { params: { viewMode: "neighbourhood" } },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
  });

  it("hides a card in the whole project, and leaves the rest of the project drawn", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode: "whole" },
      flowNodes: PROJECT_IDS.length,
    });
    await waitFor(() =>
      expect(tableIds(container)).toEqual(PROJECT_IDS.toSorted()),
    );
    await press(user, "button", "Hide", node(container, "a"));
    // c is reached from a source only through a, so it goes with it; the start b stays.
    await waitFor(() =>
      expect(tableIds(container)).toEqual(
        PROJECT_IDS.filter((id) => id !== "a" && id !== "c").sort(),
      ),
    );
    await expectPosted("persistHiddenCards", {
      args: { params: { cards: [{ id: "a", label: "a" }] } },
    });
  });

  it("shows a plain count on each card in the whole project, and a click on it does nothing", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode: "whole" },
    });
    await waitFor(() =>
      expect(tableIds(container)).toEqual(PROJECT_IDS.toSorted()),
    );
    const card = container.querySelector<HTMLElement>('[data-table="b"]')!;
    // The count is a span, not a button, and there is no live "Show N parents" or "Show N children" control.
    expect(within(card).queryByRole("button", { name: /parents/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /children/ })).toBeNull();
    const parents = card.querySelector<HTMLElement>('[title="1 parents"]')!;
    const children = card.querySelector<HTMLElement>('[title="1 children"]')!;
    expect(parents.tagName).toBe("SPAN");
    expect(parents).toHaveTextContent("1");
    expect(children).toHaveTextContent("1");

    const requestsBefore = [
      ...commands("parentTables"),
      ...commands("childTables"),
    ].length;
    await user.click(parents);
    await user.click(children);
    expect([
      ...commands("parentTables"),
      ...commands("childTables"),
    ]).toHaveLength(requestsBefore);
    expect(tableIds(container)).toEqual(PROJECT_IDS.toSorted());
  });

  it("relays the neighbourhood out when a depth settles, and posts it", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Settings");
    expect(tableIds(container)).toEqual(["a", "b", "c"]);
    await typeInto(user, "spinbutton", "Upstream depth", "0");
    await expectPosted("persistLineageSettings", {
      args: { params: { upstreamDepth: 0 } },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(["b", "c"]));
    await typeInto(user, "spinbutton", "Downstream depth", "0");
    await expectPosted("persistLineageSettings", {
      args: { params: { downstreamDepth: 0 } },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(["b"]));
  });

  it("keeps the card budget, and posts it as it changes", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { cardBudget: 2 },
      flowNodes: 2,
    });
    expect(tableIds(container)).toEqual(["a", "b"]);
    // b's child c is left out by the budget, so b shows the count it could not draw.
    expect(
      within(
        node(container, "b").getByRole("button", { name: /more children/ }),
      ).getByText("+1"),
    ).toBeInTheDocument();
    await press(user, "button", "Settings");
    await typeInto(user, "spinbutton", "Card budget", "3");
    await expectPosted("persistLineageSettings", {
      args: { params: { cardBudget: 3 } },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
  });

  it("posts the card budget once after typing settles, not per keystroke", async () => {
    const { user } = await openLineage(undefined, {
      settings: { cardBudget: 2 },
      flowNodes: 2,
    });
    await press(user, "button", "Settings");
    await typeInto(user, "spinbutton", "Card budget", "150");
    await expectPosted("persistLineageSettings", {
      args: { params: { cardBudget: 150 } },
    });
    expect(commands("persistLineageSettings")).toHaveLength(1);
  });

  it("'more' on a budget-capped card draws it without refetching or losing the expansions", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { cardBudget: 2 },
      flowNodes: 2,
    });
    expect(tableIds(container)).toEqual(["a", "b"]);
    await press(user, "button", "Columns", node(container, "a"));
    // A manual expansion made before the click must survive it.
    await press(user, "button", "Show 1 children", node(container, "a"));
    const fetchesBefore = [
      ...commands("childTables"),
      ...commands("parentTables"),
      ...commands("getColumns"),
    ].length;
    await press(user, "button", "Show 1 more children", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
    expect([
      ...commands("childTables"),
      ...commands("parentTables"),
      ...commands("getColumns"),
    ]).toHaveLength(fetchesBefore);
    // The column list of a survived the rebuild-free change of budget.
    expect(
      node(container, "a").getByRole("button", { name: "id" }),
    ).toBeInTheDocument();
    // So did the expansion `a` made by hand.
    expect(
      node(container, "a").getByRole("button", { name: "Hide 1 children" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("a selection and a manual expansion survive a budget raise, the change 'more' makes", async () => {
    // A click on a card's own control selects that card, so the selection is made on `a`, and the raise is made from
    // the Card budget setting: "more" raises the same setting, and a click on `b`'s control would select `b`.
    const { user, container } = await openLineage(undefined, {
      settings: { cardBudget: 2 },
      flowNodes: 2,
    });
    expect(tableIds(container)).toEqual(["a", "b"]);
    await press(user, "button", "Show 1 children", node(container, "a"));
    await zoomPast(user, container, "In");
    await user.click(node(container, "a").getByText("a"));
    const selected = () =>
      container.querySelector('.react-flow__node[data-id="a"]');
    await waitFor(() => expect(selected()).toHaveClass("selected"));
    await press(user, "button", "Settings");
    await typeInto(user, "spinbutton", "Card budget", "3");
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
    expect(selected()).toHaveClass("selected");
    expect(
      node(container, "a").getByRole("button", { name: "Hide 1 children" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("'more' on a card that both the cap and the budget limit draws new cards in one click", async () => {
    // `wide` feeds three cards. The cap of two draws two of them, and the budget of two keeps only `w_one`, so the
    // label counts two: `w_two`, which the budget leaves out, and `w_three`, which the cap does. One click raises the
    // budget by both, and draws all three children.
    const { user, container } = await openLineage(
      { node: WIDE, publication: "s:1" },
      { settings: { maxNeighbours: 2, cardBudget: 2 }, flowNodes: 2 },
    );
    expect(tableIds(container)).toEqual(["w_one", "wide"]);
    await press(
      user,
      "button",
      "Show 2 more children",
      node(container, "wide"),
    );
    await waitFor(() =>
      expect(tableIds(container)).toEqual([
        "w_one",
        "w_three",
        "w_two",
        "wide",
      ]),
    );
    expect(
      node(container, "wide").queryByRole("button", {
        name: /more children/,
      }),
    ).toBeNull();
    await expectPosted("persistLineageSettings", {
      args: { params: { cardBudget: 4 } },
    });
  });
});

describe.each(MODES)("Lineage emphasis controls in the %s view", (viewMode) => {
  const card = (container: HTMLElement, id: string) =>
    container
      .querySelector<HTMLElement>(`[data-table="${id}"]`)!
      .closest<HTMLElement>(".react-flow__node")!;

  it("highlights the path of the hovered card, and posts the setting", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await press(user, "button", "Settings");
    const box = await press(
      user,
      "checkbox",
      "Highlight the paths of the hovered or selected card",
    );
    expect(box).toBeChecked();
    await expectPosted("persistLineageSettings", {
      args: { params: { pathHighlight: true } },
    });
    expect(container.querySelectorAll(".lineage-path-edge")).toHaveLength(0);

    // The start `b` sits between `a` and `c`: hovering `c` puts its upstream `b` and `a` on the path, and its edges.
    await user.hover(container.querySelector('[data-table="c"]')!);
    expect(
      container.querySelectorAll(".react-flow__edge.lineage-path-edge"),
    ).toHaveLength(2);
    expect(card(container, "a")).toHaveClass("lineage-path");
    expect(card(container, "c")).toHaveClass("lineage-path");

    await user.unhover(container.querySelector('[data-table="c"]')!);
    expect(container.querySelectorAll(".lineage-path-edge")).toHaveLength(0);
  });

  it("dims the cards and edges off the highlighted path", async () => {
    const { user, container } = await openLineage(
      {
        node: FILTER,
        publication: "s:1",
      },
      { settings: { viewMode } },
    );
    await press(user, "button", "Settings");
    const box = await press(
      user,
      "checkbox",
      "Dim the cards and edges off the path",
    );
    expect(box).toBeChecked();
    await expectPosted("persistLineageSettings", {
      args: { params: { dimOffPath: true } },
    });
    expect(card(container, "audit")).not.toHaveClass("lineage-dimmed");

    // `audit` has no edge, so hovering `kept` leaves it off the path: it is dimmed; `filter` and `kept` are not.
    await user.hover(container.querySelector('[data-table="kept"]')!);
    expect(card(container, "audit")).toHaveClass("lineage-dimmed");
    expect(card(container, "kept")).not.toHaveClass("lineage-dimmed");
    expect(card(container, "filter")).not.toHaveClass("lineage-dimmed");
  });

  it("thins the edges of hub cards, which have more connections than lineage.maxNeighbours", async () => {
    // With a cap of one, `filter` has two children (`kept` and `audit`), so it is a hub. Only `kept` has a drawn edge.
    const { user, container } = await openLineage(
      { node: FILTER, publication: "s:1" },
      {
        settings: { maxNeighbours: 1, viewMode },
        // Only the neighbourhood starts with two cards; the whole project draws them all.
        flowNodes: viewMode === "neighbourhood" ? 2 : undefined,
      },
    );
    await press(user, "button", "Settings");
    expect(container.querySelectorAll(".lineage-hub-edge")).toHaveLength(0);
    const box = await press(user, "checkbox", "Thin the edges of hub cards");
    expect(box).toBeChecked();
    await expectPosted("persistLineageSettings", {
      args: { params: { hubDeemphasis: true } },
    });
    expect(
      container.querySelectorAll(".react-flow__edge.lineage-hub-edge"),
    ).toHaveLength(viewMode === "whole" ? WHOLE_HUB_EDGES : 1);
  });

  it("does not thin the edges of a card whose parents and children are each within the cap", async () => {
    // `b` has one parent and one child: with a cap of one, neither direction is over it, so it is no hub.
    const { user, container } = await openLineage(undefined, {
      settings: { maxNeighbours: 1, viewMode },
    });
    await press(user, "button", "Settings");
    await press(user, "checkbox", "Thin the edges of hub cards");
    // The whole project has hubs elsewhere (`hub`, `fanout` and `filter`), so only the edges of those are thinned.
    expect(container.querySelectorAll(".lineage-hub-edge")).toHaveLength(
      viewMode === "whole" ? WHOLE_HUB_EDGES : 0,
    );
  });

  // Only the neighbourhood caps a card's expansion, so only there is a hub's drawn edges fewer than its neighbours.
  it.runIf(viewMode === "neighbourhood")(
    "thins the edges of a hub whose neighbours are capped, counted from the known neighbours",
    async () => {
      const { user, container } = await openLineage(
        { node: HUB, publication: "s:1" },
        { settings: { maxNeighbours: 2 }, flowNodes: 3 },
      );
      await press(user, "button", "Settings");
      await press(user, "checkbox", "Thin the edges of hub cards");
      expect(
        container.querySelectorAll(".react-flow__edge.lineage-hub-edge"),
      ).toHaveLength(2);
    },
  );

  it("highlights a drawn relationship on the path, as a table edge is", async () => {
    // `kept` declares a relationship to `audit`, which has no table edge: under `both` the relationship joins them.
    const { user, container } = await openLineage(
      { node: FILTER, publication: "s:1" },
      {
        settings: { connections: "both", viewMode },
        refs: [
          {
            id: "kept-audit",
            from: { table: "kept", columns: [] },
            to: { table: "audit", columns: [] },
            cardinality: "many-to-one",
            source: "contract",
          },
        ],
      },
    );
    await press(user, "button", "Settings");
    await press(
      user,
      "checkbox",
      "Highlight the paths of the hovered or selected card",
    );
    await press(user, "checkbox", "Dim the cards and edges off the path");
    await user.hover(container.querySelector('[data-table="kept"]')!);
    // The path is `filter -> kept` and the relationship `audit -> kept`: both edges are on it, and `audit` is not dimmed.
    expect(
      container.querySelectorAll(".react-flow__edge.lineage-path-edge"),
    ).toHaveLength(2);
    expect(card(container, "audit")).not.toHaveClass("lineage-dimmed");
  });

  it("sets the edge opacity from its slider, on the view", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await press(user, "button", "Settings");
    const slider = await press(user, "slider", "Edge opacity 1.00");
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(
      screen.getByRole("slider", { name: "Edge opacity 0.50" }),
    ).toBeInTheDocument();
    await expectPosted("persistLineageSettings", {
      args: { params: { edgeOpacity: 0.5 } },
    });
    expect(
      container
        .querySelector<HTMLElement>(".lineage-view")!
        .style.getPropertyValue("--lineage-edge-opacity"),
    ).toBe("0.5");
  });

  it("does not call the layout engine when an emphasis control changes", async () => {
    const engine = engineFor(resolveSettings(undefined).engine);
    const layout = vi.spyOn(engine, "layout");
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    const laidOut = layout.mock.calls.length;
    await press(user, "button", "Settings");
    await press(
      user,
      "checkbox",
      "Highlight the paths of the hovered or selected card",
    );
    await press(user, "checkbox", "Dim the cards and edges off the path");
    await press(user, "checkbox", "Thin the edges of hub cards");
    fireEvent.change(await press(user, "slider", "Edge opacity 1.00"), {
      target: { value: "0.5" },
    });
    await user.hover(container.querySelector('[data-table="c"]')!);
    expect(layout.mock.calls.length).toBe(laidOut);
    layout.mockRestore();
  });
});

describe("Lineage Connections popover", () => {
  const openRelationships = async () => {
    const opened = await openLineage();
    const button = await press(opened.user, "button", "Connections");
    await press(opened.user, "radio", "Declared relationships");
    return { ...opened, button };
  };

  it("picks each connections choice and posts it", async () => {
    const { user, button } = await openRelationships();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-pressed", "true");
    await press(user, "radio", "Both");
    await expectPosted("persistLineageSettings", {
      args: { params: { connections: "both" } },
    });
    await press(user, "radio", "dbt dependencies");
    expect(button).toHaveAttribute("aria-pressed", "false");
    await expectPosted("persistLineageSettings", {
      args: { params: { connections: "dbt" } },
    });
  });

  it.each(["test", "contract", "meta", "semantic", "inferred"])(
    "toggles the %s source off",
    async (source) => {
      const { user } = await openRelationships();
      const box = await press(user, "checkbox", source);
      expect(box).not.toBeChecked();
      await expectPosted("persistLineageSettings", {
        args: {
          params: {
            enabledRefSources: expect.objectContaining({ [source]: false }),
          },
        },
      });
    },
  );

  it("changes the confidence threshold with the slider", async () => {
    const { user } = await openRelationships();
    const slider = await press(user, "slider", "Inferred confidence ≥ 0.80");
    fireEvent.change(slider, { target: { value: "0.9" } });
    expect(
      screen.getByRole("slider", { name: "Inferred confidence ≥ 0.90" }),
    ).toBeInTheDocument();
    await expectPosted("persistLineageSettings", {
      args: { params: { inferenceConfidenceThreshold: 0.9 } },
    });
  });

  it("asks for the relationships of sources too", async () => {
    const { user } = await openRelationships();
    const box = await press(
      user,
      "checkbox",
      "Infer relationships for sources",
    );
    expect(box).toBeChecked();
    await expectPosted("persistLineageSettings", {
      args: { params: { includeSourcesInInference: true } },
    });
    await expectPosted("getRelationships", {
      args: { params: { includeSources: true } },
    });
  });

  it("closes on a click on the pane", async () => {
    const { user, container, button } = await openRelationships();
    await user.click(pane(container));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Lineage Reset button", () => {
  it("redraws the graph at the default expansion", async () => {
    const { user, container } = await openLineage();
    await activate(user, "button", "Hide 1 parents", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["b", "c"]));
    const asked = commands("parentTables").length;

    await press(user, "button", "Reset");
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
    expect(commands("parentTables").length).toBeGreaterThan(asked);
  });
});

describe("Lineage Help drawer", () => {
  const openHelp = async () => {
    const opened = await openLineage();
    await activate(opened.user, "button", "Help");
    return opened;
  };

  it("opens from the Help button", async () => {
    const { user } = await openLineage();
    await press(user, "button", "Help");
    expect(
      screen.getByRole("complementary", { name: "Help" }),
    ).toBeInTheDocument();
    expect(
      drawer("Help").getByRole("link", { name: "Documentation" }),
    ).toBeInTheDocument();
  });

  it("follows the documentation link", async () => {
    const { user } = await openHelp();
    const followed = vi.fn((event: Event) => event.preventDefault());
    document.addEventListener("click", followed);
    try {
      const link = await press(user, "link", "Documentation", drawer("Help"));
      expect(link).toHaveAttribute(
        "href",
        "https://docs.getdbt.com/terms/data-lineage",
      );
      expect(followed).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener("click", followed);
    }
  });

  it("closes from its Close button", async () => {
    const { user } = await openHelp();
    await press(user, "button", "Close", drawer("Help"));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
  });

  it("closes from its backdrop", async () => {
    const { user } = await openHelp();
    await pressElement(user, "button", "Close", backdropOf("Help"));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
  });
});

describe("Lineage canvas controls", () => {
  const scale = (container: HTMLElement) =>
    /scale\(([\d.]+)\)/.exec(
      container.querySelector<HTMLElement>(".react-flow__viewport")!.style
        .transform,
    )?.[1];

  it("toggles the minimap", async () => {
    const { user, container } = await openLineage();
    expect(container.querySelector(".react-flow__minimap")).toBeNull();
    const show = await press(user, "button", "Show minimap");
    expect(show).toHaveAttribute("aria-pressed", "true");
    expect(show).toHaveAccessibleName("Hide minimap");
    expect(container.querySelector(".react-flow__minimap")).not.toBeNull();
    await press(user, "button", "Hide minimap");
    expect(container.querySelector(".react-flow__minimap")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show minimap" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("zooms in and out, and fits the view", async () => {
    const { user, container } = await openLineage();
    await waitFor(() => expect(scale(container)).toBeDefined());
    const fitted = scale(container);
    await press(user, "button", "Zoom In");
    await waitFor(() =>
      expect(Number(scale(container))).toBeGreaterThan(Number(fitted)),
    );
    await press(user, "button", "Zoom Out");
    await press(user, "button", "Zoom Out");
    await waitFor(() =>
      expect(Number(scale(container))).toBeLessThan(Number(fitted)),
    );
    const zoomedOut = Number(scale(container));
    await press(user, "button", "Fit View");
    await waitFor(() =>
      expect(Number(scale(container))).toBeGreaterThan(zoomedOut),
    );
  });
  it("runs the panel's fit from Fit View, centred on the start card", async () => {
    const { user } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    fits.length = 0;
    await press(user, "button", "Fit View");
    await waitFor(() => expect(fits.length).toBeGreaterThan(0));
    expect(fits.at(-1)).toEqual({ focusId: HUB.table });
  });
});

describe("Lineage table node", () => {
  it("collapses and expands the parents", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Hide 1 parents", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["b", "c"]));
    await press(user, "button", "Show 1 parents", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
    await expectPosted("parentTables", { args: { params: { table: "b" } } });
  });

  it("collapses and expands the children", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Hide 1 children", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b"]));
    await press(user, "button", "Show 1 children", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b", "c"]));
    await expectPosted("childTables", { args: { params: { table: "b" } } });
  });

  it("expands the parents of a child", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Show 1 parents", node(container, "c"));
    await expectPosted("parentTables", { args: { params: { table: "c" } } });
    expect(tableIds(container)).toEqual(["a", "b", "c"]);
  });

  it("leaves a table without parents or children as it is", async () => {
    const { user, container } = await openLineage();
    const asked = getVsCodeApiMock().postMessage.mock.calls.length;
    await press(user, "button", "Show 0 parents", node(container, "a"));
    await press(user, "button", "Show 0 children", node(container, "c"));
    expect(getVsCodeApiMock().postMessage.mock.calls).toHaveLength(asked);
    expect(tableIds(container)).toEqual(["a", "b", "c"]);
  });

  it("expands the children of the source", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Show 1 children", node(container, "a"));
    expect(tableIds(container)).toEqual(["a", "b", "c"]);
    await expectPosted("childTables", { args: { params: { table: "a" } } });
  });

  it("opens the file of a table", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Open file", node(container, "b"));
    await expectPosted("openFile", {
      args: { params: { url: "models/b.sql" } },
    });
  });

  it("lists the columns, traces one and hides the list", async () => {
    const { user, container } = await openLineage();
    const columns = await press(
      user,
      "button",
      "Columns",
      node(container, "b"),
    );
    expect(columns).toHaveAttribute("aria-pressed", "true");
    const column = await waitFor(() =>
      node(container, "b").getByRole("button", { name: "id" }),
    );
    await expectPosted("getColumns", {
      args: { params: { table: "b", refresh: false } },
    });

    await pressElement(user, "button", "id", column);
    await waitFor(() =>
      expect(
        node(container, "b").getByRole("button", { name: "id" }).className,
      ).toMatch(/selected/),
    );
    await expectPosted("getConnectedColumns");

    await press(user, "button", "Columns", node(container, "b"));
    expect(columns).toHaveAttribute("aria-pressed", "false");
    expect(node(container, "b").queryByTestId("lineage-columns")).toBeNull();
  });

  it("lists and hides the columns of the source and of the sink", async () => {
    const { user, container } = await openLineage();
    for (const id of ["a", "c"]) {
      const columns = await press(
        user,
        "button",
        "Columns",
        node(container, id),
      );
      expect(columns).toHaveAttribute("aria-pressed", "true");
      await expectPosted("getColumns", {
        args: { params: { table: id, refresh: false } },
      });
      await press(user, "button", "Columns", node(container, id));
      expect(columns).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("opens the file of the source", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Open file", node(container, "a"));
    await expectPosted("openFile", {
      args: { params: { url: "models/schema.yml" } },
    });
  });
});

describe("Lineage details drawer", () => {
  const openDetails = async (id = "a") => {
    const opened = await openLineage();
    await activate(
      opened.user,
      "button",
      "Details",
      node(opened.container, id),
    );
    await screen.findByRole("button", { name: "Columns (1)" });
    return opened;
  };

  it("opens from the Details button of a table", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Details", node(container, "a"));
    expect(
      screen.getByRole("complementary", { name: "Details" }),
    ).toBeInTheDocument();
    expect(
      drawer("Details").getByRole("heading", { name: "a" }),
    ).toBeInTheDocument();
    await expectPosted("getColumns", {
      args: { params: { table: "a", refresh: false } },
    });
  });

  it("opens the details of the table", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Details", node(container, "b"));
    expect(
      drawer("Details").getByRole("heading", { name: "b" }),
    ).toBeInTheDocument();
  });

  it("opens the details of the sink", async () => {
    const { user, container } = await openLineage();
    await press(user, "button", "Details", node(container, "c"));
    expect(
      drawer("Details").getByRole("heading", { name: "c" }),
    ).toBeInTheDocument();
  });

  it("opens the file of the table", async () => {
    const { user } = await openDetails();
    await press(user, "button", "Open file", drawer("Details"));
    await expectPosted("openFile", {
      args: { params: { url: "models/schema.yml" } },
    });
  });

  it("syncs a source with the database", async () => {
    const { user } = await openDetails();
    await press(user, "button", "Sync with database", drawer("Details"));
    await expectPosted("getColumns", {
      args: { params: { table: "a", refresh: true } },
    });
  });

  it("switches between its tabs", async () => {
    const { user } = await openDetails();
    const columns = drawer("Details").getByRole("button", {
      name: "Columns (1)",
    });
    expect(columns).toHaveAttribute("aria-pressed", "true");
    const tests = await press(user, "button", "Tests (0)", drawer("Details"));
    expect(tests).toHaveAttribute("aria-pressed", "true");
    expect(columns).toHaveAttribute("aria-pressed", "false");
    const meta = await press(user, "button", "Meta", drawer("Details"));
    expect(meta).toHaveAttribute("aria-pressed", "true");
    await press(user, "button", "Columns (1)", drawer("Details"));
    expect(columns).toHaveAttribute("aria-pressed", "true");
    expect(
      drawer("Details").getByRole("cell", { name: "id" }),
    ).toBeInTheDocument();
  });

  it("closes from its Close button", async () => {
    const { user } = await openDetails();
    await press(user, "button", "Close", drawer("Details"));
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });

  it("closes from its backdrop", async () => {
    const { user } = await openDetails();
    await pressElement(user, "button", "Close", backdropOf("Details"));
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });
});

describe.each(MODES)("Lineage card click in the %s view", (viewMode) => {
  it("only selects at normal zoom", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await zoomPast(user, container, "In");
    await user.click(node(container, "b").getByText("b"));
    await waitFor(() =>
      expect(
        container.querySelector('.react-flow__node[data-id="b"]'),
      ).toHaveClass("selected"),
    );
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });

  it("opens the Details drawer when zoomed out", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await zoomPast(user, container, "Out");
    await user.click(node(container, "b").getByText("b"));
    await waitFor(() =>
      expect(
        drawer("Details").getByRole("heading", { name: "b" }),
      ).toBeTruthy(),
    );
  });

  it("with lineage.semanticZoom off, keeps the full card and only selects when zoomed out", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { semanticZoom: false, viewMode },
    });
    await zoomPast(user, container, "Out");
    expect(container.querySelector("[data-table]")?.className).not.toContain(
      "zoomedOut",
    );
    await user.click(node(container, "b").getByText("b"));
    await waitFor(() =>
      expect(
        container.querySelector('.react-flow__node[data-id="b"]'),
      ).toHaveClass("selected"),
    );
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });
});

describe("Lineage notice", () => {
  it("shows the notice in place of a graph, with its buttons", async () => {
    const { container } = await openLineage(EMPTY_STATE);
    expect(
      screen.getByText(/Lineage needs a compiled project/),
    ).toBeInTheDocument();
    expect(nodes(container)).toHaveLength(0);
  });

  it("opens the Problems tab", async () => {
    const { user } = await openLineage(EMPTY_STATE);
    await press(user, "button", "Click here");
    await expectPosted("openProblemsTab");
  });

  it("runs the action of the notice", async () => {
    const { user } = await openLineage(EMPTY_STATE);
    await press(user, "button", "Use strict analysis");
    await expectPosted("runNoticeAction", { action: "useStrictAnalysis" });
  });
});

describe("Lineage group node", () => {
  it("groups by the host's cap even when the render arrives before the settings answer", async () => {
    const { container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 }, renderFirst: true },
    );
    expect(tableIds(container)).toEqual(["hub"]);
    expect(container.querySelector('[data-group="staging"]')).not.toBeNull();
  });

  it("opens a group, drawing its first cap members as ordinary cards", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    expect(tableIds(container)).toEqual(["hub"]);
    expect(container.querySelector('[data-group="staging"]')).not.toBeNull();

    fits.length = 0;
    await press(user, "button", "Open staging");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2"]),
    );
    // Opening a group changes the drawn nodes, so the panel refits, centred on the start card.
    await waitFor(() => expect(fits.length).toBeGreaterThan(0));
    expect(fits.at(-1)).toEqual({ focusId: HUB.table });
    expect(container.querySelector('[data-group="staging"]')).toBeNull();
    expect(container.querySelector('[data-group="marts"]')).not.toBeNull();
    expect(flowNodes(container)).toHaveLength(4);

    await press(user, "button", "Open marts");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "m1", "m2", "s1", "s2"]),
    );
    expect(container.querySelector("[data-group]")).toBeNull();
  });

  it("closes an opened group from its chip, which draws its group card again", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    await press(user, "button", "Open staging");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2"]),
    );
    await press(user, "button", "Close staging", node(container, "hub"));
    await waitFor(() => expect(tableIds(container)).toEqual(["hub"]));
    expect(container.querySelector('[data-group="staging"]')).not.toBeNull();
  });

  it("shows the next members of an open group from its +K button", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    await press(user, "button", "Open staging");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2"]),
    );
    await press(
      user,
      "button",
      "Show 1 more in staging",
      node(container, "hub"),
    );
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2", "s3"]),
    );
    expect(
      screen.queryByRole("button", { name: "Show 1 more in staging" }),
    ).toBeNull();
  });

  it("runs the controls of the members a group draws", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    await press(user, "button", "Open staging");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2"]),
    );
    for (const member of ["s1", "s2"]) {
      await press(user, "button", "Show 1 parents", node(container, member));
      await press(user, "button", "Show 0 children", node(container, member));
      await press(user, "button", "Columns", node(container, member));
      await press(user, "button", "Details", node(container, member));
      await press(user, "button", "Close", drawer("Details"));
    }
  });

  it("collapses and expands the hub's children, which draws and removes its groups", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    await press(user, "button", "Hide 6 children", node(container, "hub"));
    await waitFor(() => expect(flowNodes(container)).toHaveLength(1));
    await press(user, "button", "Show 6 children", node(container, "hub"));
    await waitFor(() => expect(flowNodes(container)).toHaveLength(3));
  });

  it("runs the hub's other controls", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    await press(user, "button", "Show 0 parents", node(container, "hub"));
    await press(user, "button", "Columns", node(container, "hub"));
    await screen.findByRole("button", { name: "id" });
    await press(user, "button", "Details", node(container, "hub"));
    await press(user, "button", "Close", drawer("Details"));
    expect(screen.queryByRole("complementary", { name: "Details" })).toBeNull();
  });
});

/** Opens every group of `FANOUT`, drawing its ten children: its chip row then draws three chips and a +2 more button. */
const openOverflowGroups = async () => {
  const opened = await openLineage(
    { node: FANOUT, publication: "s:1" },
    { settings: { maxNeighbours: 5 }, flowNodes: 6 },
  );
  for (const folder of FANOUT_GROUPS) {
    await press(opened.user, "button", `Open ${folder}`);
  }
  await waitFor(() => expect(tableIds(opened.container)).toHaveLength(11));
  return opened;
};

describe("Lineage overflow groups", () => {
  it.each(["epsilon", "gamma"])(
    "closes the %s group from the +N popover, which then has no +N button",
    async (folder) => {
      const { user, container } = await openOverflowGroups();
      await press(user, "button", "+2 more", node(container, "fanout"));
      await press(user, "button", `Close ${folder}`);
      await waitFor(() =>
        expect(tableIds(container)).not.toContain(`${folder}1`),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(
        node(container, "fanout").queryByRole("button", { name: /more$/ }),
      ).toBeNull();
    },
  );

  it("closes the groups the chip row draws inline", async () => {
    const { user, container } = await openOverflowGroups();
    for (const folder of ["alpha", "beta", "delta"]) {
      await press(user, "button", `Close ${folder}`, node(container, "fanout"));
    }
    await waitFor(() =>
      expect(tableIds(container)).toEqual([
        "epsilon1",
        "epsilon2",
        "fanout",
        "gamma1",
        "gamma2",
      ]),
    );
  });

  it("runs the controls of the members of the overflow groups and of the hub", async () => {
    const { user, container } = await openOverflowGroups();
    for (const member of FANOUT_MEMBERS) {
      await press(user, "button", "Show 1 parents", node(container, member));
      await press(user, "button", "Show 0 children", node(container, member));
      await press(user, "button", "Columns", node(container, member));
      await press(user, "button", "Details", node(container, member));
      await press(user, "button", "Close", drawer("Details"));
    }
    await press(user, "button", "Show 0 parents", node(container, "fanout"));
    await press(user, "button", "Columns", node(container, "fanout"));
    await press(user, "button", "Details", node(container, "fanout"));
    await press(user, "button", "Close", drawer("Details"));
    await press(user, "button", "Hide 10 children", node(container, "fanout"));
    await waitFor(() => expect(flowNodes(container)).toHaveLength(1));
    await press(user, "button", "Show 10 children", node(container, "fanout"));
    await waitFor(() => expect(flowNodes(container)).toHaveLength(6));
  }, 30_000);
});

describe("Lineage card strip", () => {
  // The strip hangs under the card's bottom edge and the bottom expander sits on that edge. The layout is not computed
  // here, so the stacking order of the strip and the bubble is checked in TableNode.test.tsx.
  it("clicks the strip's buttons and the bottom expander on the start card", async () => {
    const { user, container } = await openLineage();
    expect(
      await press(user, "button", "Columns", node(container, "b")),
    ).toHaveAttribute("aria-pressed", "true");
    await press(user, "button", "Open file", node(container, "b"));
    await expectPosted("openFile", {
      args: { params: { url: "models/b.sql" } },
    });
    await press(user, "button", "Hide 1 children", node(container, "b"));
    await waitFor(() => expect(tableIds(container)).toEqual(["a", "b"]));
  });

  it("clicks the strip's buttons on a selected card", async () => {
    const { user, container } = await openLineage();
    await user.click(node(container, "a").getByText("a"));
    await waitFor(() =>
      expect(
        container.querySelector('.react-flow__node[data-id="a"]'),
      ).toHaveClass("selected"),
    );
    await press(user, "button", "Open file", node(container, "a"));
    await expectPosted("openFile", {
      args: { params: { url: "models/schema.yml" } },
    });
    await press(user, "button", "Details", node(container, "a"));
    await screen.findByRole("complementary", { name: "Details" });
  });

  it("selects the card a click on its control lands on, as the default does", async () => {
    const { user, container } = await openLineage();
    expect(
      container.querySelector('.react-flow__node[data-id="c"]'),
    ).not.toHaveClass("selected");
    await press(user, "button", "Columns", node(container, "c"));
    await waitFor(() =>
      expect(
        container.querySelector('.react-flow__node[data-id="c"]'),
      ).toHaveClass("selected"),
    );
  });

  it("leaves the selection as it was on a click on a control, and a click on the body still selects", async () => {
    controlClicks.selects = false;
    try {
      const { user, container } = await openLineage();
      await user.click(node(container, "a").getByText("a"));
      await waitFor(() =>
        expect(
          container.querySelector('.react-flow__node[data-id="a"]'),
        ).toHaveClass("selected"),
      );
      await press(user, "button", "Columns", node(container, "c"));
      expect(
        container.querySelector('.react-flow__node[data-id="c"]'),
      ).not.toHaveClass("selected");
      expect(
        container.querySelector('.react-flow__node[data-id="a"]'),
      ).toHaveClass("selected");
      await user.click(node(container, "c").getByText("c"));
      await waitFor(() =>
        expect(
          container.querySelector('.react-flow__node[data-id="c"]'),
        ).toHaveClass("selected"),
      );
    } finally {
      controlClicks.selects = true;
    }
  });

  it("reaches the strip's buttons from the keyboard and clicks them on a hovered card", async () => {
    const { user, container } = await openLineage();
    const columns = node(container, "c").getByRole("button", {
      name: "Columns",
    });
    columns.focus();
    expect(columns).toHaveFocus();
    await user.hover(node(container, "c").getByText("c"));
    expect(
      await press(user, "button", "Columns", node(container, "c")),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe.each(MODES)("Lineage Hide control in the %s view", (viewMode) => {
  /**
   * The cards a view draws with `a` hidden. In the whole project `c` goes too, as the only card drawn through `a`; the
   * neighbourhood starts at `b`, so `c` stays.
   */
  const withoutA = viewMode === "whole" ? projectWithout("a", "c") : ["b", "c"];
  const all = drawnIn(viewMode, ["a", "b", "c"]);

  /** Opens every group of `FANOUT`, as the coverage gate's overflow state does. */
  const openOverflow = async () => {
    const opened = await openLineage(
      { node: FANOUT, publication: "s:1" },
      { settings: { maxNeighbours: 5 }, flowNodes: 6 },
    );
    for (const folder of FANOUT_GROUPS) {
      await activate(opened.user, "button", `Open ${folder}`);
    }
    await screen.findByRole("button", { name: "+2 more" });
    return opened;
  };

  it("hides a card and posts the hidden set, and the card is no longer drawn", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await press(user, "button", "Hide", node(container, "a"));
    await waitFor(() => expect(tableIds(container)).toEqual(withoutA));
    await expectPosted("persistHiddenCards", {
      args: { params: { cards: [{ id: "a", label: "a" }] } },
    });
  });

  it("hides a child card the same way, and leaves the start drawn", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await press(user, "button", "Hide", node(container, "c"));
    // In the whole project `a` is reached only through `c`, so it goes with it; the start `b` is always drawn.
    await waitFor(() =>
      expect(tableIds(container)).toEqual(
        viewMode === "whole" ? projectWithout("a", "c") : ["a", "b"],
      ),
    );
    await expectPosted("persistHiddenCards", {
      args: { params: { cards: [{ id: "c", label: "c" }] } },
    });
  });

  // The whole project has no expansion groups, so only the neighbourhood opens them.
  it.runIf(viewMode === "neighbourhood")(
    "hides each card of an open group, one at a time",
    async () => {
      const { user, container } = await openOverflow();
      for (const member of FANOUT_MEMBERS) {
        await press(user, "button", "Hide", node(container, member));
      }
      await expectPosted("persistHiddenCards", {
        args: {
          params: {
            cards: FANOUT_MEMBERS.map((member) => ({
              id: member,
              label: member,
            })),
          },
        },
      });
      await waitFor(() => expect(tableIds(container)).toEqual(["fanout"]));
    },
  );

  // The whole project has no capped groups, so only the neighbourhood draws them.
  it.runIf(viewMode === "neighbourhood")(
    "hides the cards of a capped group, which the expansion drew",
    async () => {
      const { user, container } = await openLineage(
        { node: HUB, publication: "s:1" },
        { settings: { maxNeighbours: 2 } },
      );
      await activate(user, "button", "Open staging");
      await screen.findByRole("button", { name: "Close staging" });
      await waitFor(() => expect(node(container, "s1")).toBeDefined());
      await press(user, "button", "Hide", node(container, "s1"));
      await press(user, "button", "Hide", node(container, "s2"));
      await expectPosted("persistHiddenCards", {
        args: {
          params: {
            cards: [
              { id: "s1", label: "s1" },
              { id: "s2", label: "s2" },
            ],
          },
        },
      });
    },
  );

  // The neighbourhood draws a group only through the card that opened it, so hiding that card takes the group too.
  // `s1` starts the view; `hub`, its parent, is drawn through it, and the group `hub` opens is drawn through `hub` only.
  it.runIf(viewMode === "neighbourhood")(
    "hides a card and the group only it drew, and keeps the start",
    async () => {
      const { user, container } = await openLineage(
        { node: HUB_CHILDREN[0]!, publication: "s:1" },
        { settings: { maxNeighbours: 2 }, flowNodes: 2 },
      );
      expect(tableIds(container)).toEqual(["hub", "s1"]);
      await press(user, "button", "Show 6 children", node(container, "hub"));
      await activate(user, "button", "Open staging");
      await screen.findByRole("button", { name: "Close staging" });
      await waitFor(() => expect(tableIds(container)).toContain("s3"));
      await press(user, "button", "Hide", node(container, "hub"));
      await waitFor(() => expect(tableIds(container)).toEqual(["s1"]));
    },
  );

  it("restores a hidden card from the settings list", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
      hidden: [{ id: "a", label: "a" }],
      flowNodes: withoutA.length,
    });
    await waitFor(() => expect(tableIds(container)).toEqual(withoutA));
    await press(user, "button", "Settings");
    await press(user, "button", "Restore a");
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    await expectPosted("persistHiddenCards", {
      args: { params: { cards: [] } },
    });
  });

  it("lists a hidden card by the label it was hidden with, or by its id when none was stored", async () => {
    const { user } = await openLineage(undefined, {
      settings: { viewMode },
      hidden: [
        { id: "model.proj.orders", label: "orders" },
        { id: "model.proj.legacy" },
      ],
    });
    await press(user, "button", "Settings");
    expect(
      screen.getByRole("button", { name: "Restore orders" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore model.proj.legacy" }),
    ).toBeInTheDocument();
  });

  it("restores every hidden card with Restore all", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
      hidden: [
        { id: "a", label: "a" },
        { id: "c", label: "c" },
      ],
      flowNodes: viewMode === "whole" ? projectWithout("a", "c").length : 1,
    });
    await waitFor(() =>
      expect(tableIds(container)).toEqual(
        viewMode === "whole" ? projectWithout("a", "c") : ["b"],
      ),
    );
    await press(user, "button", "Settings");
    await press(user, "button", "Restore all");
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    await expectPosted("persistHiddenCards", {
      args: { params: { cards: [] } },
    });
  });

  it("says in the settings list that no card is hidden, when none is", async () => {
    const { user } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await press(user, "button", "Settings");
    expect(screen.getByText(/No cards are hidden/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore all" })).toBeNull();
  });
});

describe.each(MODES)("Lineage Scope control in the %s view", (viewMode) => {
  /**
   * The cards the view draws with every filter on, and with each filter the tests switch off. The whole project also
   * drops a card drawn only through a removed one, as the hiding rule does: `c` goes with `a`, and `a` with `c`.
   */
  const all = drawnIn(viewMode, ["a", "b", "c"]);
  const withoutSource =
    viewMode === "whole" ? projectWithout("a", "c") : ["b", "c"];
  const withoutModels = viewMode === "whole" ? ["b"] : ["a", "b"];
  const withoutC = viewMode === "whole" ? projectWithout("a", "c") : ["a", "b"];
  /** The count the Scope popover shows for the cards the filters take out of the drawn graph. */
  const filteredOut =
    viewMode === "whole" ? "2 cards filtered out" : "1 card filtered out";

  const openScope = (user: User) => press(user, "button", "Scope");

  it("removes the cards of an unchecked node type, and the cards drawn only through them", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    await openScope(user);
    await press(user, "checkbox", "source");
    await waitFor(() => expect(tableIds(container)).toEqual(withoutSource));
    expect(screen.getByText(filteredOut)).toBeInTheDocument();
    await expectPosted("persistLineageScope", {
      args: { params: { scope: { offTypes: ["source"], offTags: [] } } },
    });
  });

  it("removes every card of an unchecked node type", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    await openScope(user);
    await press(user, "checkbox", "model");
    await waitFor(() => expect(tableIds(container)).toEqual(withoutModels));
  });

  it("removes a card only once every one of its tags is unchecked", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    await openScope(user);
    await press(user, "checkbox", "nightly");
    // `c` keeps its other tag, `finance`, so it stays drawn.
    expect(tableIds(container)).toEqual(all);
    await press(user, "checkbox", "finance");
    await waitFor(() => expect(tableIds(container)).toEqual(withoutC));
  });

  // In the whole project `a` is drawn only through `c`, so it goes with `c`; the neighbourhood draws it on its own.
  it.runIf(viewMode === "neighbourhood")(
    "keeps an untagged card drawn when every tag of the others is unchecked",
    async () => {
      const { user, container } = await openLineage(undefined, {
        settings: { viewMode },
      });
      await waitFor(() => expect(tableIds(container)).toEqual(all));
      await openScope(user);
      await press(user, "checkbox", "nightly");
      await press(user, "checkbox", "finance");
      await waitFor(() => expect(tableIds(container)).toEqual(withoutC));
      expect(tableIds(container)).toContain("a");
    },
  );

  it("changes the drawn graph without fetching it again", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
    });
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    const fetches = () =>
      ["childTables", "parentTables", "getProjectGraph", "tableEdges"].map(
        (command) => commands(command).length,
      );
    const before = fetches();
    await openScope(user);
    await press(user, "checkbox", "source");
    await waitFor(() => expect(tableIds(container)).toEqual(withoutSource));
    expect(fetches()).toEqual(before);
  });

  it("applies the stored filters when the panel opens, and shows them unchecked", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
      scope: { offTypes: ["source"], offTags: [] },
      flowNodes: withoutSource.length,
    });
    await waitFor(() => expect(tableIds(container)).toEqual(withoutSource));
    await openScope(user);
    expect(screen.getByRole("checkbox", { name: "source" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "model" })).toBeChecked();
    expect(screen.getByText(filteredOut)).toBeInTheDocument();
  });

  it("switches every filter back on with Show all, and saves that", async () => {
    const { user, container } = await openLineage(undefined, {
      settings: { viewMode },
      scope: { offTypes: ["source"], offTags: [] },
      flowNodes: withoutSource.length,
    });
    await waitFor(() => expect(tableIds(container)).toEqual(withoutSource));
    await openScope(user);
    await press(user, "button", "Show all");
    await waitFor(() => expect(tableIds(container)).toEqual(all));
    expect(screen.getByText("0 cards filtered out")).toBeInTheDocument();
    await expectPosted("persistLineageScope", {
      args: { params: { scope: { offTypes: [], offTags: [] } } },
    });
  });
});

describe("Lineage TESTED_CONTROLS", () => {
  it("lists exactly the controls the tests above clicked", () => {
    expect([...clicked].toSorted()).toEqual(TESTED_CONTROLS.toSorted());
  });
});
