import { screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectPosted } from "../../test/controlCoverage";
import { controlRecorder } from "../../test/controlRecorder";
import {
  ERROR,
  HISTORY,
  openQueryPanel,
  RESULTS,
  sizeGridsForVirtualizer,
  TESTED_CONTROLS,
} from "../../test/queryPanelControls";

/**
 * The Query panel controls suite. The coverage gate imports this file, so its tests and `TESTED_CONTROLS`
 * run there too.
 */

type User = ReturnType<typeof userEvent.setup>;

const { clicked, press, pressElement, typeInto } = controlRecorder();

/**
 * An icon-only button shows its label only on hover, so it has no name at rest. Finds the button by its icon,
 * a codicon, hovers it, and returns it by the name the hover shows.
 */
const hoverToName = async (
  user: User,
  icon: string,
  name: string,
): Promise<HTMLElement> => {
  const element = document
    .querySelector(`.codicon-${icon}`)!
    .closest<HTMLElement>("button")!;
  await user.hover(element);
  return screen.getByRole("button", { name });
};

/** The drawer labelled `label`, whose controls are scoped by its label. */
const drawer = (label: string) =>
  within(screen.getByRole("complementary", { name: label }));

/** The history row that runs `rawSql`; its controls are found within the row. */
const historyRow = (rawSql: string) =>
  within(
    screen.getByRole("button", { name: rawSql }).closest<HTMLElement>("li")!,
  );

/** The text of the SQL block on screen, with its line numbers. */
const shownCode = () => document.querySelector("code")?.textContent;

sizeGridsForVirtualizer();

// ---- the tests ----

describe("Query panel toolbar", () => {
  it("edits the limit and saves it as the default", async () => {
    const { user } = openQueryPanel();
    await typeInto(user, "spinbutton", "Limit", "250");
    await press(user, "button", "Save");
    await expectPosted("updateConfig", { limit: 250 });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("runs the active SQL file with the limit", async () => {
    const { user } = openQueryPanel({
      command: "getContext",
      limit: 500,
      activeEditor: { filepath: "/p/a.sql", query: "select 1" },
    });
    await press(user, "button", "Run query");
    await expectPosted("executeQueryFromActiveWindow", { limit: 500 });
  });

  it("runs a new query", async () => {
    const { user } = openQueryPanel();
    await press(user, "button", "open-adhoc-query");
    await expectPosted("runAdhocQuery");
  });

  it("opens the results in a tab", async () => {
    const { user } = openQueryPanel(RESULTS);
    const button = await hoverToName(user, "link-external", "Open in Tab");
    await pressElement(user, "button", "Open in Tab", button);
    await expectPosted("queryResultTab:render");
  });

  it("clears the results", async () => {
    const { user } = openQueryPanel(RESULTS);
    const button = await hoverToName(user, "close", "Clear results");
    await pressElement(user, "button", "Clear results", button);
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear results" })).toBeNull();
  });

  it("hides the toolbar in a results tab", () => {
    openQueryPanel({
      command: "updateViewType",
      args: { body: { type: 1 } },
    });
    expect(screen.queryByRole("spinbutton", { name: "Limit" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "open-adhoc-query" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
  });
});

describe("Query panel preview mode", () => {
  const model = "/project/models/orders.sql";
  const previewOf = (mode: "computed" | "materialized") => ({
    ...RESULTS,
    preview: { mode, model },
  });

  it("shows a computed preview and asks for the materialized one", async () => {
    const { user } = openQueryPanel(previewOf("computed"));
    expect(screen.getByText("Computed")).toBeTruthy();
    const button = await hoverToName(
      user,
      "debug-restart",
      "Show materialized",
    );
    await pressElement(user, "button", "Show materialized", button);
    await expectPosted("switchPreview", { mode: "materialized", model });
  });

  it("shows a materialized preview and asks for the computed one", async () => {
    const { user } = openQueryPanel(previewOf("materialized"));
    expect(screen.getByText("Materialized")).toBeTruthy();
    const button = await hoverToName(user, "debug-restart", "Show computed");
    await pressElement(user, "button", "Show computed", button);
    await expectPosted("switchPreview", { mode: "computed", model });
  });

  it("shows no toggle for a result without a model preview", () => {
    openQueryPanel(RESULTS);
    expect(screen.queryByText("Computed")).toBeNull();
    expect(screen.queryByText("Materialized")).toBeNull();
  });

  it("hides the toggle once the results are cleared", async () => {
    const { user } = openQueryPanel(previewOf("computed"));
    expect(screen.getByText("Computed")).toBeTruthy();
    const button = await hoverToName(user, "close", "Clear results");
    await pressElement(user, "button", "Clear results", button);
    expect(screen.queryByText("Computed")).toBeNull();
  });

  it("hides the toggle while a new query loads", () => {
    openQueryPanel(previewOf("materialized"), { command: "renderLoading" });
    expect(screen.queryByText("Materialized")).toBeNull();
  });

  it("does not show the toggle in a results tab", () => {
    openQueryPanel(
      { command: "updateViewType", args: { body: { type: 1 } } },
      previewOf("computed"),
    );
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.queryByText("Computed")).toBeNull();
  });
});

describe("Query panel tabs", () => {
  it("shows the welcome tab when there are no results", async () => {
    const { user } = openQueryPanel();
    await press(user, "button", "Welcome 🚀");
    expect(screen.getByRole("button", { name: "Welcome 🚀" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches between the History, Preview and SQL tabs", async () => {
    const { user } = openQueryPanel(RESULTS);
    await press(user, "button", "History");
    expect(
      screen.getByRole("heading", { name: /History/ }),
    ).toBeInTheDocument();

    await press(user, "button", "SQL");
    expect(shownCode()).toContain("select * from orders");
    expect(screen.queryByRole("grid")).toBeNull();

    await press(user, "button", "Preview 2 rows");
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});

describe("Query panel grid", () => {
  it("sorts by a column when its header is clicked", async () => {
    const { user } = openQueryPanel(RESULTS);
    const header = screen.getByRole("columnheader", { name: "id" });
    expect(header).toHaveAttribute("aria-sort", "none");
    await user.click(header);
    const first = header.getAttribute("aria-sort");
    expect(first).not.toBe("none");
    await user.click(header);
    expect(header.getAttribute("aria-sort")).not.toBe(first);
  });

  it("resizes each column from its handle", async () => {
    const { user } = openQueryPanel(RESULTS);
    for (const column of ["id", "name", "payload"]) {
      const handle = await press(user, "button", `Resize column ${column}`);
      const header = screen.getByRole("columnheader", { name: column });
      const before = header.style.width;
      await user.pointer([
        { keys: "[MouseLeft>]", target: handle, coords: { clientX: 0 } },
        { coords: { clientX: 40 } },
        { keys: "[/MouseLeft]" },
      ]);
      await waitFor(() => expect(header.style.width).not.toBe(before));
    }
  });

  it("exports the rows as CSV", async () => {
    const { user } = openQueryPanel(RESULTS);
    const createObjectURL = vi.fn(() => "blob:csv");
    const original = URL.createObjectURL;
    URL.createObjectURL = createObjectURL;
    try {
      await press(user, "button", "Export CSV");
    } finally {
      URL.createObjectURL = original;
    }
    const [blob] = createObjectURL.mock.calls[0] as unknown as [Blob];
    const lines = (await blob.text()).split("\r\n");
    expect(lines[0]).toBe("id,name,payload");
    expect(lines[1]).toBe('"1","alpha","{""a"": 1}"');
  });

  it("views a cell's complete value in the drawer", async () => {
    const { user } = openQueryPanel(RESULTS);
    await press(user, "button", "View complete value");
    expect(drawer("payload").getByText(/"a": 1/)).toBeInTheDocument();
    await press(user, "button", "Close", drawer("payload"));
    expect(screen.queryByRole("complementary", { name: "payload" })).toBeNull();
  });
});

describe("Query panel loader", () => {
  it("cancels a query while it runs", async () => {
    const { user } = openQueryPanel({ command: "renderLoading" });
    await press(user, "button", "Cancel query");
    await expectPosted("cancelQuery");
  });

  it("opens the docs link for the hint", async () => {
    const { user } = openQueryPanel({ command: "renderLoading" });
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link).toHaveAttribute("href", expect.stringMatching(/^https:/));
    await press(user, "link", "Docs");
  });
});

describe("Query panel error", () => {
  it("copies the error details", async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    try {
      const { user } = openQueryPanel(ERROR);
      expect(
        screen.getByRole("heading", { name: "Syntax error" }),
      ).toBeInTheDocument();
      await press(user, "button", "Copy to clipboard");
      await screen.findByRole("button", { name: "Copied to clipboard" });
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("Syntax error"),
      );
    } finally {
      writeText.mockRestore();
    }
  });

  it("shows the error's tab with no rows", async () => {
    const { user } = openQueryPanel(ERROR);
    await press(user, "button", "Preview 0 rows");
    expect(
      screen.getByRole("heading", { name: "Syntax error" }),
    ).toBeInTheDocument();
  });
});

describe("Query panel history", () => {
  it("shows a history entry and opens or views it", async () => {
    const { user } = openQueryPanel(HISTORY);
    await press(user, "button", "History");
    await press(user, "button", "select 1");
    expect(shownCode()).toContain("select 1");
    await press(user, "button", "Show results");
    await expectPosted("viewResultSet", {
      queryHistory: expect.objectContaining({ rawSql: "select 1" }),
    });
    await press(user, "button", "Open in editor");
    await expectPosted("openCodeInEditor", { code: "select 1" });
  });

  it("executes each history entry from its own row", async () => {
    const { user } = openQueryPanel(HISTORY);
    await press(user, "button", "History");
    await press(user, "button", "Execute query", historyRow("select 1"));
    await expectPosted("executeQuery", {
      query: "select 1",
      projectName: "demo",
      editorName: "stg_orders",
    });

    await press(user, "button", "select * from orders");
    expect(shownCode()).toContain("select * from orders");
    await press(
      user,
      "button",
      "Execute query",
      historyRow("select * from orders"),
    );
    await expectPosted("executeQuery", { query: "select * from orders" });
  });

  it("asks for a new query when the history is empty", async () => {
    const { user } = openQueryPanel();
    await press(user, "button", "History");
    await press(user, "button", "+ New query");
    await expectPosted("runAdhocQuery");
  });

  it("filters the history by its search", async () => {
    const { user } = openQueryPanel(HISTORY);
    await press(user, "button", "History");
    await press(user, "button", "Search query");
    await user.type(screen.getByPlaceholderText("Search query"), "orders");
    await waitFor(
      () =>
        expect(screen.queryByRole("button", { name: "select 1" })).toBeNull(),
      { timeout: 3000 },
    );
    expect(
      screen.getByRole("button", { name: "select * from orders" }),
    ).toBeInTheDocument();
  });

  it("renders one Search query button, because the history passes no tags to Filters", async () => {
    // Filters also renders a tag button named "Search query", but QueryPanelHistory always passes tags={[]}, so
    // the card's by-position test for the second button has no control to click. This fails once tags are wired.
    const { user } = openQueryPanel(HISTORY);
    await press(user, "button", "History");
    expect(
      screen.getAllByRole("button", { name: "Search query" }),
    ).toHaveLength(1);
  });
});

describe("Query panel controls", () => {
  it("lists exactly the controls the tests above clicked", () => {
    expect([...clicked].toSorted()).toEqual(TESTED_CONTROLS.toSorted());
  });
});
