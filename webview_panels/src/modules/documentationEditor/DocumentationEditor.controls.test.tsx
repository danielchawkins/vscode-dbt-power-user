import AppProvider from "@modules/app/AppProvider";
import { handleIncomingResponse } from "@modules/app/requestExecutor";
import DocumentationProvider from "@modules/documentationEditor/DocumentationProvider";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ControlId,
  controlId,
  expectPosted,
  InteractiveRole,
} from "../../test/controlCoverage";
import { getVsCodeApiMock } from "../../test/setup";

/**
 * The documentation editor controls suite. The coverage gate imports this file, so its tests and `TESTED_CONTROLS`
 * run there too.
 */

type User = ReturnType<typeof userEvent.setup>;
type Scope = { getByRole: typeof screen.getByRole };

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

/** Clicks the control with `role` and `name`, and records it as tested. */
const press = (
  user: User,
  role: InteractiveRole,
  name: string,
  scope: Scope = screen,
) => pressElement(user, role, name, scope.getByRole(role, { name }));

/**
 * Replaces the value of the field with `placeholder`. These fields have no accessible name (a placeholder is not one),
 * so the typing is not recorded: the coverage gate leaves them out (see the pins there).
 */
const typeInto = async (user: User, placeholder: string, value: string) => {
  const element = screen.getByPlaceholderText(placeholder);
  await user.clear(element);
  await user.type(element, value);
  return element;
};

/** Picks `option` in the select with `name`, and records it as tested. */
const selectInto = async (user: User, name: string, option: string) => {
  const element = screen.getByRole("combobox", { name });
  clicked.add(controlId("combobox", name, element));
  await user.selectOptions(element, option);
  return element;
};

/**
 * The Sync button shows its label only on hover, so it has no name at rest. Finds the button by its icon, hovers it,
 * and records the press by the name the hover shows.
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

/**
 * The save chevron is an icon-only button with no title, label or text, so it has no name at all. The tests click it
 * without recording it; the coverage gate leaves it out (see the pins there).
 */
const saveChevron = (): HTMLElement =>
  document
    .querySelector(".codicon-chevron-down")!
    .closest<HTMLElement>("button")!;

/** The two buttons named `Close` that a drawer without a label renders: the backdrop and the one in its `aside`. */
const closeButtons = () => screen.getAllByRole("button", { name: "Close" });

/** The close button in the drawer's `aside`. */
const drawerClose = (): HTMLElement =>
  closeButtons().find((button) => button.closest("aside") !== null)!;

/** The backdrop of the drawer: the button the drawer renders just before its `aside`. */
const backdrop = (): HTMLElement =>
  closeButtons().find(
    (button) => button.nextElementSibling?.tagName === "ASIDE",
  )!;

/** The drawer labelled `label`, whose controls are scoped by its label. */
const drawer = (label: string) =>
  within(screen.getByRole("complementary", { name: label }));

/** The `aside` of the open drawer, which has no label. */
const openDrawer = () => within(screen.getByRole("complementary"));

/** The add-test button of the entity titled `title`. It is titled `Minimize` while its menu is open. */
const addTestButton = (title: string): HTMLElement =>
  screen.getByRole("button", { name: `Add test for ${title}` });

/**
 * The row of an entity's data tests and add-test menu, found from its add-test button. Duplicate test names are told
 * apart by their row.
 */
const rowOf = (button: HTMLElement) => within(button.parentElement!);

/** The row of unit tests of the model. */
const unitTestsRow = () =>
  within(screen.getByText("Unit Tests:").parentElement!);

/** The `Insert doc block reference` buttons, in document order: the model's first, then each column's. */
const docBlockInserters = () =>
  screen.getAllByRole("button", { name: "Insert doc block reference" });

/** Answers the sync requests the editor makes, with the body the host would send for each command. */
const ANSWERS: Record<string, unknown> = {
  getColumnsOfModel: { columns: ["id", "email"] },
  getColumnsOfSources: { columns: ["id"] },
  getDistinctColumnValues: ["placed", "shipped", "returned"],
  getModelsInProject: { models: ["customers"] },
  getSourcesInProject: { sources: [] },
  getTestCode: { sql: "select order_id from orders", config: "version: 2" },
  getUnitTestCode: { yaml: "name: unit_totals" },
  saveDocumentation: { saved: true, documentation: {}, tests: [] },
  showInformationMessage: "Yes, overwrite",
};

const answerRequests = () =>
  getVsCodeApiMock().postMessage.mockImplementation((message: unknown) => {
    const { command, syncRequestId } = message as {
      command: string;
      syncRequestId?: string;
    };
    if (syncRequestId) {
      queueMicrotask(() =>
        handleIncomingResponse({
          syncRequestId,
          status: true,
          body: ANSWERS[command],
        }),
      );
    }
  });

/** Dispatches a host message to the panel. */
const send = (data: object) =>
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });

/** Renders the editor inside the app, then dispatches each host message to it. */
export const openDocumentation = (...messages: object[]) => {
  answerRequests();
  const user = userEvent.setup();
  const { container } = render(
    <AppProvider>
      <DocumentationProvider />
    </AppProvider>,
  );
  messages.forEach(send);
  return { user, container };
};

/** A model with three columns, two model tests and column tests, five unit tests and two doc blocks. */
export const DOCUMENTATION = {
  command: "renderDocumentation",
  docs: {
    name: "orders",
    description: "Orders placed by customers.",
    columns: [
      {
        name: "order_id",
        type: "integer",
        description: "Primary key.",
        source: "YAML",
      },
      { name: "status", type: "varchar", description: "", source: "YAML" },
      {
        name: "customer_id",
        type: "integer",
        description: "",
        source: "YAML",
      },
    ],
    filePath: "/project/models/orders.sql",
    patchPath: "/project/models/schema.yml",
    uniqueId: "model.demo.orders",
    resource_type: "model",
  },
  project: "demo",
  tests: [
    {
      key: "row_count",
      column_name: null,
      test_metadata: { name: "row_count", kwargs: { model: "orders" } },
    },
    {
      key: "amount_positive",
      column_name: null,
      test_metadata: {
        name: "amount_positive",
        kwargs: { model: "orders" },
      },
    },
    {
      key: "recent_orders",
      column_name: null,
      test_metadata: {
        name: "recent_orders",
        kwargs: { model: "orders" },
      },
    },
    {
      key: "status_mix",
      column_name: null,
      test_metadata: { name: "status_mix", kwargs: { model: "orders" } },
    },
    {
      key: "order_id_not_null",
      column_name: "order_id",
      test_metadata: {
        name: "not_null",
        kwargs: { column_name: "order_id", model: "orders" },
      },
    },
    {
      key: "order_id_unique",
      column_name: "order_id",
      test_metadata: {
        name: "unique",
        kwargs: { column_name: "order_id", model: "orders" },
      },
    },
    {
      key: "status_accepted",
      column_name: "status",
      test_metadata: {
        name: "accepted_values",
        kwargs: {
          column_name: "status",
          model: "orders",
          values: ["placed", "shipped"],
        },
      },
    },
    {
      key: "customer_id_relationships",
      column_name: "customer_id",
      test_metadata: {
        name: "relationships",
        kwargs: {
          column_name: "customer_id",
          model: "orders",
          to: "ref('customers')",
          field: "id",
        },
      },
    },
  ],
  unitTests: [
    { name: "unit_totals", path: "models/unit_tests.yml" },
    { name: "unit_status", path: "models/unit_tests.yml" },
    { name: "unit_refunds", path: "models/unit_tests.yml" },
    { name: "unit_discounts", path: "models/unit_tests.yml" },
    { name: "unit_tax", path: "models/unit_tests.yml" },
  ],
  docBlocks: [
    { name: "intro", path: "docs/intro.md" },
    { name: "orders_summary", path: "docs/orders.md" },
  ],
};

/** The same model with no schema file, so saving asks where to write it. */
export const WITHOUT_SCHEMA = {
  ...DOCUMENTATION,
  docs: { ...DOCUMENTATION.docs, patchPath: undefined },
};

/** The host has no documented model for the active editor, and says why. */
export const NO_DOCS = {
  command: "renderDocumentation",
  docBlocks: [],
  missingDocumentationMessage: {
    type: "error",
    message: "No documented model in the active editor.",
  },
};

const DESCRIPTION = "Describe your model";
const INSERT = "Insert doc block reference";

/** The description field with `placeholder`, typed as a textarea so its value can be read. */
const screenTextarea = (placeholder: string) =>
  screen.getByPlaceholderText<HTMLTextAreaElement>(placeholder);

/** Edits the model description, which makes the editor dirty. */
const editModel = (user: User) => typeInto(user, DESCRIPTION, "Edited.");

// ---- the tests ----

describe("Documentation editor descriptions", () => {
  it("edits the model description and marks it modified", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await editModel(user);
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue("Edited.");
    expect(screen.getByText("modified")).toBeInTheDocument();
  });

  it("edits a column description", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await typeInto(user, "Describe status", "Order state.");
    expect(screen.getByPlaceholderText("Describe status")).toHaveValue(
      "Order state.",
    );
    expect(screen.getByText("modified")).toBeInTheDocument();
  });

  it("filters the columns with the search box", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const search = screen.getByRole("search");
    await user.type(search, "stat");
    expect(screen.queryByPlaceholderText("Describe order_id")).toBeNull();
    expect(screen.getByPlaceholderText("Describe status")).toBeInTheDocument();
    await user.clear(search);
    expect(
      screen.getByPlaceholderText("Describe order_id"),
    ).toBeInTheDocument();
  });

  it("syncs the columns with the database", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const sync = await hoverToName(
      user,
      "debug-restart",
      "Sync with the Database",
    );
    await pressElement(user, "button", "Sync with the Database", sync);
    await expectPosted("fetchMetadataFromDatabase");
    send({
      command: "renderColumnsFromMetadataFetch",
      columns: [
        { name: "order_id", type: "integer" },
        { name: "shipped_at", type: "timestamp" },
      ],
    });
    expect(
      await screen.findByPlaceholderText("Describe shipped_at"),
    ).toBeInTheDocument();
  });
});

describe("Documentation editor doc blocks", () => {
  it("inserts a doc block reference into the model description", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await pressElement(user, "button", INSERT, docBlockInserters()[0]!);
    await press(user, "button", "orders_summary");
    expect(screenTextarea(DESCRIPTION).value).toContain(
      "{{ doc('orders_summary') }}",
    );
  });

  it("inserts a doc block reference into a column description", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await pressElement(user, "button", INSERT, docBlockInserters()[1]!);
    await press(user, "button", "intro");
    expect(screenTextarea("Describe order_id").value).toContain(
      "{{ doc('intro') }}",
    );
  });

  it("filters the doc blocks with the search box", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await pressElement(user, "button", INSERT, docBlockInserters()[0]!);
    await typeInto(user, "Search doc blocks...", "intro");
    expect(screen.queryByRole("button", { name: "orders_summary" })).toBeNull();
    await typeInto(user, "Search doc blocks...", "zzz");
    expect(
      screen.getByText('No doc blocks found matching "zzz"'),
    ).toBeInTheDocument();
  });
});

describe("Documentation editor save", () => {
  it("saves the documentation from the Save button", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await editModel(user);
    await press(user, "button", "Save");
    await expectPosted("saveDocumentation", {
      name: "orders",
      patchPath: "/project/models/schema.yml",
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save" })).toBeNull(),
    );
  });

  it("saves from the chevron menu", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await editModel(user);
    await user.click(saveChevron());
    expect(screen.getByText("/project/models/schema.yml")).toBeInTheDocument();
    const dialog = within(screen.getByRole("dialog"));
    await press(user, "button", "Save", dialog);
    await expectPosted("saveDocumentation", { name: "orders" });
  });

  it("saves to a new schema file when the model has none", async () => {
    const { user } = openDocumentation(WITHOUT_SCHEMA);
    await editModel(user);
    await press(user, "button", "Save");
    const dialog = within(screen.getByRole("dialog"));
    await press(user, "button", "New file", dialog);
    await expectPosted("saveDocumentation", { dialogType: "New file" });
  });

  it("saves to an existing schema file when the model has none", async () => {
    const { user } = openDocumentation(WITHOUT_SCHEMA);
    await editModel(user);
    await press(user, "button", "Save");
    const dialog = within(screen.getByRole("dialog"));
    await press(user, "button", "Existing file", dialog);
    await expectPosted("saveDocumentation", { dialogType: "Existing file" });
  });
});

describe("Documentation editor data tests", () => {
  it("opens a model test's details and its code", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "row_count");
    await expectPosted("getTestCode", { model: "orders" });
    expect(openDrawer().getByText("Column:", { exact: false })).toBeTruthy();
    expect(document.querySelector("aside")?.textContent).toContain(
      "select order_id from orders",
    );
  });

  it("shows all the model tests", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "1 test +");
    expect(screen.queryByRole("button", { name: "1 test +" })).toBeNull();
    await press(user, "button", "status_mix");
    expect(openDrawer().getByText("status_mix")).toBeInTheDocument();
  });

  it("opens the details of the other model tests and of a column test", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    for (const name of ["amount_positive", "recent_orders", "unique"]) {
      await press(user, "button", name);
      expect(openDrawer().getByText(name)).toBeInTheDocument();
      await pressElement(user, "button", "Close", drawerClose());
    }
  });

  it("opens and closes the add-test menu of the model", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const add = addTestButton("orders");
    await pressElement(user, "button", "Add test for orders", add);
    expect(
      rowOf(add).getByRole("button", { name: "Minimize" }),
    ).toBeInTheDocument();
    await press(user, "button", "Minimize", rowOf(add));
    expect(rowOf(add).queryByRole("button", { name: "Minimize" })).toBeNull();
  });

  it("closes a test drawer with its close button", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "row_count");
    await pressElement(user, "button", "Close", drawerClose());
    expect(document.querySelector("aside")).toBeNull();
  });

  it("closes a test drawer from its backdrop", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "row_count");
    await pressElement(user, "button", "Close", backdrop());
    expect(document.querySelector("aside")).toBeNull();
  });

  it("deletes a column test from its drawer", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "not_null");
    await press(user, "button", "Delete test");
    expect(screen.queryByRole("button", { name: "not_null" })).toBeNull();
    await expectPosted("saveDraft", { model: "/project/models/orders.sql" });
  });

  it("edits an accepted values test and saves it", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "accepted_values");
    await press(user, "button", "Edit test");
    await press(user, "button", "Remove placed");
    await typeInto(
      user,
      "Type a value and press enter to add",
      "returned{Enter}",
    );
    await press(user, "button", "Get distinct column values");
    expect(
      await screen.findByRole("button", { name: "Remove returned" }),
    ).toBeInTheDocument();
    await press(user, "button", "Remove shipped");
    await press(user, "button", "Update");
    await expectPosted("saveDraft", {
      draft: expect.objectContaining({
        tests: expect.arrayContaining([
          expect.objectContaining({
            key: "status_accepted",
            test_metadata: expect.objectContaining({
              kwargs: expect.objectContaining({
                values: ["placed", "returned"],
              }),
            }),
          }),
        ]),
      }),
    });
    expect(document.querySelector("aside")).toBeNull();
  });

  it("cancels an edit of an accepted values test", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "accepted_values");
    await press(user, "button", "Edit test");
    await press(user, "button", "Cancel");
    expect(screen.queryByRole("button", { name: "Remove placed" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit test" }),
    ).toBeInTheDocument();
  });

  it("edits a relationships test", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "relationships");
    await press(user, "button", "Edit test");
    await selectInto(user, "Field", "email");
    expect(screen.getByRole("combobox", { name: "Field" })).toHaveValue(
      "email",
    );
    await press(user, "button", "Update");
    await expectPosted("saveDraft", {
      draft: expect.objectContaining({
        tests: expect.arrayContaining([
          expect.objectContaining({
            key: "customer_id_relationships",
            test_metadata: expect.objectContaining({
              kwargs: expect.objectContaining({ field: "email" }),
            }),
          }),
        ]),
      }),
    });
  });

  it("toggles the add-test menu", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const add = addTestButton("order_id");
    await pressElement(user, "button", "Add test for order_id", add);
    const row = rowOf(add);
    expect(
      row.getByRole("button", { name: "accepted_values" }),
    ).toBeInTheDocument();
    expect(
      row.getByRole("button", { name: "relationships" }),
    ).toBeInTheDocument();
    await press(user, "button", "Minimize", row);
    expect(row.queryByRole("button", { name: "accepted_values" })).toBeNull();
  });

  it("adds a not_null test from the add-test menu", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const add = addTestButton("customer_id");
    await pressElement(user, "button", "Add test for customer_id", add);
    const row = rowOf(add);
    await press(user, "button", "not_null", row);
    await waitFor(() =>
      expect(row.getAllByRole("button", { name: "not_null" })).toHaveLength(1),
    );
    await expectPosted("saveDraft", { model: "/project/models/orders.sql" });
  });

  it("adds an accepted values test from its form", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const add = addTestButton("customer_id");
    await pressElement(user, "button", "Add test for customer_id", add);
    await press(user, "button", "accepted_values", rowOf(add));
    await press(user, "button", "Get distinct column values");
    expect(
      await screen.findByRole("button", { name: "Remove returned" }),
    ).toBeInTheDocument();
    await press(user, "button", "Add", openDrawer());
    await expectPosted("saveDraft", { model: "/project/models/orders.sql" });
    expect(document.querySelector("aside")).toBeNull();
  });

  it("adds a relationships test from its form", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const add = addTestButton("status");
    await pressElement(user, "button", "Add test for status", add);
    await press(user, "button", "relationships", rowOf(add));
    await selectInto(user, "To", "ref('customers')");
    await selectInto(user, "Field", "email");
    await press(user, "button", "Add", openDrawer());
    await expectPosted("saveDraft", { model: "/project/models/orders.sql" });
    await waitFor(() =>
      expect(
        rowOf(add).getByRole("button", { name: "relationships" }),
      ).toBeInTheDocument(),
    );
  });

  it("cancels the add-test form", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const add = addTestButton("status");
    await pressElement(user, "button", "Add test for status", add);
    await press(user, "button", "relationships", rowOf(add));
    await press(user, "button", "Cancel", openDrawer());
    expect(document.querySelector("aside")).toBeNull();
  });
});

describe("Documentation editor unit tests", () => {
  it("opens a unit test's code", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "2 tests +");
    expect(screen.queryByRole("button", { name: "2 tests +" })).toBeNull();
    await press(user, "button", "unit_discounts", unitTestsRow());
    await press(user, "button", "unit_refunds", unitTestsRow());
    await press(user, "button", "unit_totals", unitTestsRow());
    await expectPosted("getUnitTestCode", { name: "unit_totals" });
    expect(
      await screen.findByRole("heading", { name: "Unit Test: unit_totals" }),
    ).toBeInTheDocument();
  });

  it("closes the unit test drawer with its close button and backdrop", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "unit_status");
    await pressElement(user, "button", "Close", drawerClose());
    expect(document.querySelector("aside")).toBeNull();
    await press(user, "button", "unit_status");
    await pressElement(user, "button", "Close", backdrop());
    expect(document.querySelector("aside")).toBeNull();
  });
});

describe("Documentation editor tooltips and links", () => {
  it("links to the data tests docs from the tooltip", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const info = screen
      .getAllByText("Data Tests:")[0]!
      .querySelector<HTMLElement>(".codicon-info")!;
    await user.hover(info);
    const link = within(screen.getByRole("tooltip")).getByRole("link", {
      name: "dbt docs ↗",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://docs.getdbt.com/docs/build/data-tests",
    );
    await pressElement(user, "link", "dbt docs ↗", link);
  });

  it("links to the unit tests docs from the tooltip", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    const info = screen
      .getByText("Unit Tests:")
      .querySelector<HTMLElement>(".codicon-info")!;
    await user.hover(info);
    const link = within(screen.getByRole("tooltip")).getByRole("link", {
      name: "dbt docs ↗",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://docs.getdbt.com/docs/build/unit-tests",
    );
    await pressElement(user, "link", "dbt docs ↗", link);
  });
});

describe("Documentation editor help", () => {
  it("switches the help between its documentation and tests pages", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "Help");
    const help = drawer("Help");
    expect(help.getByRole("link", { name: "documentation" })).toHaveAttribute(
      "href",
      "https://docs.getdbt.com/docs/build/documentation",
    );
    await press(user, "button", "Tests", help);
    expect(help.getByRole("link", { name: "documentation" })).toHaveAttribute(
      "href",
      "https://docs.getdbt.com/docs/build/data-tests",
    );
    await press(user, "button", "Documentation", help);
    await pressElement(
      user,
      "link",
      "documentation",
      help.getByRole("link", { name: "documentation" }),
    );
  });

  it("closes the help with its close button", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "Help");
    await press(user, "button", "Close", drawer("Help"));
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
  });

  it("closes the help from its backdrop", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "Help");
    await pressElement(user, "button", "Close", backdrop());
    expect(screen.queryByRole("complementary", { name: "Help" })).toBeNull();
  });

  it("opens the Problems tab from the help shown with no documented model", async () => {
    const { user } = openDocumentation(NO_DOCS);
    expect(
      screen.getByRole("heading", { name: "Documentation Help" }),
    ).toBeInTheDocument();
    await press(user, "button", "Click here");
    await expectPosted("openProblemsTab");
    await pressElement(
      user,
      "link",
      "documentation",
      screen.getByRole("link", { name: "documentation" }),
    );
  });
});

/** Every control a test above clicked. */
export const TESTED_CONTROLS: readonly ControlId[] = [
  "button:1 test +",
  "button:2 tests +",
  "button:Add",
  "button:Add test for customer_id",
  "button:Add test for order_id",
  "button:Add test for orders",
  "button:Add test for status",
  "button:Cancel",
  "button:Click here",
  "button:Close",
  "button:Delete test",
  "button:Edit test",
  "button:Existing file",
  "button:Get distinct column values",
  "button:Help",
  "button:Help/Close",
  "button:Help/Documentation",
  "button:Help/Tests",
  "button:Help/backdrop Close",
  "button:Insert doc block reference",
  "button:Minimize",
  "button:New file",
  "button:Remove placed",
  "button:Remove shipped",
  "button:Save",
  "button:Sync with the Database",
  "button:Update",
  "button:accepted_values",
  "button:amount_positive",
  "button:intro",
  "button:not_null",
  "button:orders_summary",
  "button:recent_orders",
  "button:relationships",
  "button:row_count",
  "button:status_mix",
  "button:unique",
  "button:unit_discounts",
  "button:unit_refunds",
  "button:unit_status",
  "button:unit_totals",
  "combobox:Field",
  "combobox:To",
  "link:Help/documentation",
  "link:dbt docs ↗",
  "link:documentation",
];

describe("Documentation editor controls", () => {
  it("lists exactly the controls the tests above clicked", () => {
    expect([...clicked].sort()).toEqual([...TESTED_CONTROLS].sort());
  });
});
