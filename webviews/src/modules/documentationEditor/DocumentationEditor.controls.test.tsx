import { screen, waitFor, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { controlId, expectPosted } from "../../test/controlCoverage";
import { controlRecorder } from "../../test/controlRecorder";
import {
  DESCRIPTION_PROPOSALS,
  DOCUMENTATION,
  NO_DOCS,
  openDocumentation,
  TESTED_CONTROLS,
  TYPE_PROPOSALS,
  WITHOUT_SCHEMA,
} from "../../test/documentationEditorControls";

/**
 * The documentation editor controls suite. The coverage gate imports this file, so its tests and `TESTED_CONTROLS`
 * run there too.
 */

type User = ReturnType<typeof userEvent.setup>;

const { clicked, press, pressElement } = controlRecorder();

/**
 * Replaces the value of the field with `placeholder`. These fields have no accessible name (a placeholder is not one),
 * so the typing is not recorded: the coverage gate leaves them out (see the pins there).
 */
const typeIntoPlaceholder = async (
  user: User,
  placeholder: string,
  value: string,
) => {
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

const DESCRIPTION = "Describe your model";
const INSERT = "Insert doc block reference";

/** The description field with `placeholder`, typed as a textarea so its value can be read. */
const screenTextarea = (placeholder: string) =>
  screen.getByPlaceholderText<HTMLTextAreaElement>(placeholder);

/** Edits the model description, which makes the editor dirty. */
const editModel = (user: User) =>
  typeIntoPlaceholder(user, DESCRIPTION, "Edited.");

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
    await typeIntoPlaceholder(user, "Describe status", "Order state.");
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
    await typeIntoPlaceholder(user, "Search doc blocks...", "intro");
    expect(screen.queryByRole("button", { name: "orders_summary" })).toBeNull();
    await typeIntoPlaceholder(user, "Search doc blocks...", "zzz");
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
    await typeIntoPlaceholder(
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

/** A notice that offers the strict analysis action. */
const STRICT_NOTICE = {
  command: "renderColumnProposals",
  payload: {
    kind: "types",
    model: "/project/models/orders.sql",
    proposals: [],
    notFound: [],
    notice: {
      message: "Inferred types need strict analysis.",
      type: "warning",
      actions: [{ title: "Use strict analysis", action: "useStrictAnalysis" }],
    },
  },
};

describe("Column proposal controls", () => {
  it("records the column types and pulls the upstream descriptions", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await press(user, "button", "Record column types");
    await press(user, "button", "Pull upstream descriptions");
    await expectPosted("proposeColumns", { kind: "types" });
    await expectPosted("proposeColumns", { kind: "descriptions" });
  });

  it("ticks the overwrite and accepts it, then accepts the added column", async () => {
    const { user } = openDocumentation(DOCUMENTATION, TYPE_PROPOSALS);
    const tick = await press(
      user,
      "checkbox",
      "Replace data_type of customer_id",
    );
    await press(
      user,
      "button",
      "Accept",
      within(tick.closest("label")!.parentElement!),
    );
    await press(
      user,
      "button",
      "Accept",
      within(screen.getByText(/Add column discount/).parentElement!),
    );
  });

  it("accepts all the type proposals", async () => {
    const { user } = openDocumentation(DOCUMENTATION, TYPE_PROPOSALS);
    await press(user, "button", "Accept all");
  });

  it("dismisses the type proposals", async () => {
    const { user } = openDocumentation(DOCUMENTATION, TYPE_PROPOSALS);
    await press(user, "button", "Dismiss");
  });

  it("uses the strict analysis action a notice carries", async () => {
    const { user } = openDocumentation(DOCUMENTATION, STRICT_NOTICE);
    await press(user, "button", "Use strict analysis");
    await expectPosted("runNoticeAction", { action: "useStrictAnalysis" });
    // With no proposal, the summary offers nothing to accept.
    expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
  });

  it("accepts a single description, and picks one of two before accepting the other", async () => {
    const { user } = openDocumentation(DOCUMENTATION, DESCRIPTION_PROPOSALS);
    await press(
      user,
      "button",
      "Accept",
      within(screen.getByText(/Customer key/).parentElement!),
    );
    await press(user, "radio", "Order status from model.demo.raw.status");
    await press(user, "radio", "Fulfilment state from model.demo.ship.state");
    await press(
      user,
      "button",
      "Accept",
      within(
        screen
          .getByRole("radio", {
            name: "Fulfilment state from model.demo.ship.state",
          })
          .closest("fieldset")!.parentElement!,
      ),
    );
  });

  it("skips a description", async () => {
    const { user } = openDocumentation(DOCUMENTATION, DESCRIPTION_PROPOSALS);
    await press(
      user,
      "button",
      "Skip",
      within(screen.getByText(/Customer key/).parentElement!),
    );
  });
});

describe("Documentation editor controls", () => {
  it("lists exactly the controls the tests above clicked", () => {
    expect([...clicked].toSorted()).toEqual(TESTED_CONTROLS.toSorted());
  });
});
