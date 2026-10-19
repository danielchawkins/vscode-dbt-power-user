import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ControlId, InteractiveRole } from "../../test/controlCoverage";
import { controlId, expectPosted } from "../../test/controlCoverage";
import type { Scope, User } from "../../test/lineageHarness";
import {
  activate,
  commands,
  EMPTY_STATE,
  flowNodes,
  HUB,
  node,
  nodes,
  openLineage,
  pane,
  tableIds,
} from "../../test/lineageHarness";
import { getVsCodeApiMock } from "../../test/setup";

/** Every control a test below clicked. */
const clicked = new Set<ControlId>();

/** Clicks `element`, a control with `role` and `name`, and records it as tested. */
const pressElement = async (
  user: User,
  role: InteractiveRole,
  name: string,
  element: HTMLElement,
) => {
  clicked.add(controlId(role, name, element));
  await user.click(element);
  return element;
};

/** Clicks the control and records it as tested. */
const press = (
  user: User,
  role: InteractiveRole,
  name: string,
  scope: Scope = screen,
) => pressElement(user, role, name, scope.getByRole(role, { name }));

/** Replaces the value of the input, a control with `role` and `name`, and records it as tested. */
const typeInto = async (
  user: User,
  role: InteractiveRole,
  name: string,
  value: string,
) => {
  const element = screen.getByRole(role, { name });
  clicked.add(controlId(role, name, element));
  await user.clear(element);
  await user.type(element, value);
  return element;
};

/** The backdrop of the drawer labelled `label`: the button the drawer renders just before its `aside`. */
const backdropOf = (label: string) =>
  screen
    .getAllByRole("button", { name: "Close" })
    .find((button) =>
      button.nextElementSibling?.matches(`aside[aria-label="${label}"]`),
    )!;

const drawer = (name: string) =>
  within(screen.getByRole("complementary", { name }));

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

describe("Lineage Relationships popover", () => {
  const openRelationships = async () => {
    const opened = await openLineage();
    const button = await activate(opened.user, "button", "Relationships");
    return { ...opened, button };
  };

  it("opens and hides the overlay with Show relationships", async () => {
    const { user } = await openLineage();
    const button = await press(user, "button", "Relationships");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-pressed", "true");
    const show = await press(user, "checkbox", "Show relationships");
    expect(show).not.toBeChecked();
    expect(button).toHaveAttribute("aria-pressed", "false");
    await expectPosted("persistLineageSettings", {
      args: { params: { showRefs: false } },
    });
  });

  it.each(["test", "contract", "semantic", "inferred"])(
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
  it("opens a group, drawing its first cap members as ordinary cards", async () => {
    const { user, container } = await openLineage(
      { node: HUB, publication: "s:1" },
      { settings: { maxNeighbours: 2 } },
    );
    expect(tableIds(container)).toEqual(["hub"]);
    expect(container.querySelector('[data-group="staging"]')).not.toBeNull();

    await press(user, "button", "Open staging");
    await waitFor(() =>
      expect(tableIds(container)).toEqual(["hub", "s1", "s2"]),
    );
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

/** The controls the tests above click. Each is the id `collectControls` gives it. */
export const TESTED_CONTROLS: readonly ControlId[] = [
  "button:Settings",
  "spinbutton:Default expansion",
  "checkbox:Show select (direct) column edges",
  "checkbox:Show non-select (indirect) column edges",
  "button:Relationships",
  "checkbox:Show relationships",
  "checkbox:test",
  "checkbox:contract",
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
  "button:table hub/Hide 6 children",
  "button:table hub/Show 6 children",
  "button:table hub/Show 0 parents",
  "button:table hub/Columns",
  "button:table hub/Details",
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

describe("Lineage TESTED_CONTROLS", () => {
  it("lists exactly the controls the tests above clicked", () => {
    expect([...clicked].sort()).toEqual(TESTED_CONTROLS.toSorted());
  });
});
