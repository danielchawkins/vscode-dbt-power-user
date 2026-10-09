import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  collectControls,
  ControlId,
  expectControlsCovered,
  INTERACTIVE_ROLES,
} from "../../test/controlCoverage";
// Importing the controls suite registers its tests in this file too (TESTED_CONTROLS lives there).
import {
  activate,
  EMPTY_STATE,
  node,
  openLineage,
} from "../../test/lineageHarness";
import { TESTED_CONTROLS } from "./Lineage.controls.test";

/** Popovers render in a portal, so the controls are collected from the whole page. */
const page = () => document.body;

/** Renders the panel, then does what a user does to reach the state. */
const stateOf =
  (
    reach: (
      opened: Awaited<ReturnType<typeof openLineage>>,
    ) => Promise<unknown>,
  ) =>
  async () => {
    const opened = await openLineage();
    await reach(opened);
    return page();
  };

describe("Lineage control coverage", () => {
  it("has a test for every control in every state", async () => {
    await expectControlsCovered(
      {
        default: stateOf(async () => undefined),
        empty: async () => {
          await openLineage(EMPTY_STATE);
          return page();
        },
        "Settings open": stateOf(({ user }) =>
          activate(user, "button", "Settings"),
        ),
        "Relationships open": stateOf(({ user }) =>
          activate(user, "button", "Relationships"),
        ),
        "Help open": stateOf(({ user }) => activate(user, "button", "Help")),
        "node expanded": stateOf(async ({ user, container }) => {
          await activate(user, "button", "Columns", node(container, "b"));
          await screen.findByRole("button", { name: "id" });
        }),
        "details drawer open": stateOf(async ({ user, container }) => {
          await activate(user, "button", "Details", node(container, "a"));
          await screen.findByRole("button", { name: "Columns (1)" });
        }),
        "minimap shown": stateOf(({ user }) =>
          activate(user, "button", "Show minimap"),
        ),
      },
      TESTED_CONTROLS,
    );
  });
});

describe("Lineage control coverage gate", () => {
  it("looks for the eleven interactive roles", () => {
    expect([...INTERACTIVE_ROLES].sort()).toEqual([
      "button",
      "checkbox",
      "combobox",
      "link",
      "menuitem",
      "radio",
      "slider",
      "spinbutton",
      "switch",
      "tab",
      "textbox",
    ]);
  });

  it("gives same-named controls in a drawer and in two nodes different ids", () => {
    const { container } = render(
      <div>
        <div data-table="a">
          <button type="button">Open file</button>
        </div>
        <div data-table="b">
          <button type="button">Open file</button>
        </div>
        <aside aria-label="Help">
          <button type="button">Close</button>
        </aside>
        <button type="button">Close</button>
      </div>,
    );
    expect(collectControls(container)).toEqual([
      "button:Close",
      "button:Help/Close",
      "button:table a/Open file",
      "button:table b/Open file",
    ]);
  });

  it("collectControls throws on a button without an accessible name", () => {
    const { container } = render(
      <div>
        <button type="button">Named</button>
        <button type="button">
          <span className="codicon codicon-gear" />
        </button>
      </div>,
    );
    expect(() => collectControls(container)).toThrow(
      /button.*no accessible name.*codicon-gear/s,
    );
  });

  it("expectControlsCovered reports a control no test clicks", async () => {
    const state = () =>
      render(
        <div>
          <button type="button">Known</button>
          <button type="button">Untested</button>
          <input type="checkbox" aria-label="Also untested" />
        </div>,
      ).container;
    const tested: ControlId[] = ["button:Known"];
    const failure = await expectControlsCovered({ fake: state }, tested).then(
      () => undefined,
      (error: unknown) => (error as Error).message,
    );
    expect(failure).toContain("button:Untested (in: fake)");
    expect(failure).toContain("checkbox:Also untested (in: fake)");
    expect(failure).not.toContain("button:Known");
    await expect(
      expectControlsCovered({ fake: state }, [
        ...tested,
        "button:Untested",
        "checkbox:Also untested",
      ]),
    ).resolves.toBeUndefined();
  });
});
