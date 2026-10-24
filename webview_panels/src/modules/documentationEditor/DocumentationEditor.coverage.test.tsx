import { fireEvent, screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ControlState, InteractiveRole } from "../../test/controlCoverage";
import {
  expectControlsCovered,
  INTERACTIVE_ROLES,
} from "../../test/controlCoverage";
import {
  DESCRIPTION_PROPOSALS,
  DOCUMENTATION,
  NO_DOCS,
  openDocumentation,
  TESTED_CONTROLS,
  TYPE_PROPOSALS,
  WITHOUT_SCHEMA,
} from "../../test/documentationEditorControls";

type User = ReturnType<typeof userEvent.setup>;

/**
 * The controls with no accessible name at all: no text, no title and no label, even on hover. They are the description
 * fields (a placeholder does not name a field), the accepted-values input of a test form and the save chevron. These
 * are product gaps; the code does not change here. `collectControls` cannot read them, so the states remove them, and
 * the pins below fail once they have names, so the exclusion goes with the fix.
 */
const unnamedControls = (
  container: HTMLElement,
  roles: readonly InteractiveRole[] = INTERACTIVE_ROLES,
): HTMLElement[] =>
  roles.flatMap((role) =>
    within(container).queryAllByRole(role, {
      name: (name) => name.trim() === "",
    }),
  );

/**
 * Hovers each button with no text, the icon-only ones and the Sync button, so that the label a user sees on hover is
 * the name `collectControls` reads. `fireEvent` keeps the earlier hovers in place, which moving the pointer would not.
 * Then removes the unnamed controls, which `collectControls` would otherwise throw on.
 */
const hoverIconButtons = (container: HTMLElement): HTMLElement => {
  for (const element of container.querySelectorAll("button")) {
    if (element.textContent?.trim() === "") {
      fireEvent.mouseEnter(element);
    }
  }
  for (const element of unnamedControls(container)) {
    element.remove();
  }
  return container;
};

/**
 * A state: renders the editor with `messages`, does `reach` as a user would, then hovers its icon-only buttons.
 * Popovers and tooltips are portalled to the body, so the state collects from the body.
 */
const stateOf =
  (messages: object[], reach?: (user: User) => Promise<void>): ControlState =>
  async () => {
    const { user } = openDocumentation(...messages);
    await reach?.(user);
    return hoverIconButtons(document.body);
  };

const click = async (user: User, role: "button" | "link", name: string) => {
  await user.click(screen.getByRole(role, { name }));
};

/** The `Add test for` button of `title`, then the control named `name` in its row. */
const addTestIn = async (user: User, title: string, name: string) => {
  const add = screen.getByRole("button", { name: `Add test for ${title}` });
  await user.click(add);
  await user.click(within(add.parentElement!).getByRole("button", { name }));
};

/** Edits the model description, which makes the editor dirty. */
const editModel = async (user: User) => {
  const description = screen.getByPlaceholderText("Describe your model");
  await user.clear(description);
  await user.type(description, "Edited.");
};

describe("Documentation editor control coverage", () => {
  it("has a test for every control in every state", async () => {
    await expectControlsCovered(
      {
        default: stateOf([DOCUMENTATION]),
        "save menu open": stateOf([DOCUMENTATION], async (user) => {
          await editModel(user);
          await user.click(
            document
              .querySelector(".codicon-chevron-down")!
              .closest<HTMLElement>("button")!,
          );
        }),
        "save menu open without a schema file": stateOf(
          [WITHOUT_SCHEMA],
          async (user) => {
            await editModel(user);
            await click(user, "button", "Save");
          },
        ),
        "doc block inserter open": stateOf([DOCUMENTATION], async (user) => {
          await user.click(
            screen.getAllByRole("button", {
              name: "Insert doc block reference",
            })[0]!,
          );
        }),
        "add test form open": stateOf([DOCUMENTATION], (user) =>
          addTestIn(user, "customer_id", "accepted_values"),
        ),
        "add relationships test form open": stateOf([DOCUMENTATION], (user) =>
          addTestIn(user, "status", "relationships"),
        ),
        "test details open": stateOf([DOCUMENTATION], (user) =>
          click(user, "button", "not_null"),
        ),
        "test in edit mode": stateOf([DOCUMENTATION], async (user) => {
          await click(user, "button", "accepted_values");
          await click(user, "button", "Edit test");
        }),
        "unit tests drawer open": stateOf([DOCUMENTATION], (user) =>
          click(user, "button", "unit_totals"),
        ),
        "help open": stateOf([DOCUMENTATION], (user) =>
          click(user, "button", "Help"),
        ),
        "type proposals pending": stateOf([DOCUMENTATION, TYPE_PROPOSALS]),
        "description proposals pending": stateOf([
          DOCUMENTATION,
          DESCRIPTION_PROPOSALS,
        ]),
        "no documented model": stateOf([NO_DOCS]),
      },
      TESTED_CONTROLS,
    );
  });
});

describe("Documentation editor control coverage gate", () => {
  it("pins the four description fields as unnamed in the default state", () => {
    openDocumentation(DOCUMENTATION);
    expect(
      unnamedControls(document.body, ["textbox"]).map((element) =>
        element.getAttribute("placeholder"),
      ),
    ).toEqual([
      "Describe your model",
      "Describe order_id",
      "Describe status",
      "Describe customer_id",
    ]);
  });

  it("pins the save chevron as unnamed once the editor is dirty", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await editModel(user);
    const chevrons = unnamedControls(document.body, ["button"]).filter(
      (element) => element.querySelector(".codicon-chevron-down") !== null,
    );
    expect(chevrons).toHaveLength(1);
  });

  it("pins the accepted values input as unnamed in the add-test form", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await addTestIn(user, "customer_id", "accepted_values");
    expect(unnamedControls(document.body)).toContain(
      screen.getByPlaceholderText("Type a value and press enter to add"),
    );
  });

  it("pins the doc block search box as unnamed", async () => {
    const { user } = openDocumentation(DOCUMENTATION);
    await user.click(
      screen.getAllByRole("button", { name: "Insert doc block reference" })[0]!,
    );
    expect(
      screen.getByPlaceholderText("Search doc blocks..."),
    ).not.toHaveAccessibleName();
  });
});
