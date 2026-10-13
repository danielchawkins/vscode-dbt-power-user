import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  collectControls,
  ControlId,
  ControlState,
  expectControlsCovered,
  InteractiveRole,
} from "../../test/controlCoverage";
// Importing the controls suite registers its tests in this file too (TESTED_CONTROLS lives there).
import {
  ERROR,
  HISTORY,
  openQueryPanel,
  RESULTS,
  TESTED_CONTROLS,
} from "./QueryPanel.controls.test";

type User = ReturnType<typeof userEvent.setup>;

const click = async (user: User, role: InteractiveRole, name: string) => {
  await user.click(screen.getByRole(role, { name }));
};

/**
 * Two icon-only controls have no accessible name at rest or on hover, so the gate cannot read one: the run control in
 * the limit editor (a `div` with `role="button"`) and the close button of the history details (no `title` or label).
 * These are product gaps; the code does not change here. The states leave them out, and the pin test below fails
 * once they have names, so the exclusion goes with the fix.
 */
const isUnnamedProductControl = (element: Element): boolean =>
  element.textContent?.trim() === "" &&
  ((element.getAttribute("role") === "button" &&
    element.querySelector(".codicon-play") !== null) ||
    element.matches('button[class*="closeBtn"]:not([title])'));

/**
 * Hovers each button with no text, the icon-only ones, so that the label a user sees on hover is the name
 * `collectControls` reads. `fireEvent` keeps the earlier hovers in place, which moving the pointer would not.
 */
const hoverIconButtons = (container: HTMLElement): HTMLElement => {
  for (const element of container.querySelectorAll("[role='button'], button")) {
    if (isUnnamedProductControl(element)) {
      element.remove();
    } else if (
      element.tagName === "BUTTON" &&
      element.textContent?.trim() === ""
    ) {
      fireEvent.mouseEnter(element);
    }
  }
  return container;
};

/** A state: renders the panel with `messages`, does `reach` as a user would, then hovers its icon-only buttons. */
const stateOf =
  (messages: object[], reach?: (user: User) => Promise<void>): ControlState =>
  async () => {
    const { user, container } = openQueryPanel(...messages);
    await reach?.(user);
    return hoverIconButtons(container);
  };

describe("Query panel control coverage", () => {
  it("has a test for every control in every state", async () => {
    await expectControlsCovered(
      {
        default: stateOf([]),
        "results with rows": stateOf([RESULTS]),
        loading: stateOf([{ command: "renderLoading" }]),
        error: stateOf([ERROR]),
        "history with a row selected": stateOf([HISTORY], async (user) => {
          await click(user, "button", "History");
          await click(user, "button", "select 1");
        }),
        "filters open": stateOf([HISTORY], async (user) => {
          await click(user, "button", "History");
          await click(user, "button", "Search query");
        }),
        "limit editor open": stateOf([], async (user) => {
          const limit = screen.getByRole("spinbutton", { name: "Limit" });
          await user.clear(limit);
          await user.type(limit, "250");
        }),
        "cell drawer open": stateOf([RESULTS], (user) =>
          click(user, "button", "View complete value"),
        ),
      },
      TESTED_CONTROLS,
    );
  });
});

describe("Query panel control coverage gate", () => {
  const unnamedAtRest = (container: HTMLElement) =>
    [...container.querySelectorAll("button, [role='button']")].filter(
      isUnnamedProductControl,
    );

  it("pins the unnamed run control at rest until it has a name", () => {
    const { container } = openQueryPanel();
    expect(unnamedAtRest(container)).toHaveLength(1);
  });

  it("pins the unnamed history close button once a history row is open", async () => {
    const { user, container } = openQueryPanel(HISTORY);
    await click(user, "button", "History");
    await click(user, "button", "select 1");
    expect(unnamedAtRest(container)).toHaveLength(2);
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
