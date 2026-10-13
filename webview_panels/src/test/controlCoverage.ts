import { cleanup, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { getVsCodeApiMock } from "./setup";

/** The roles a user can operate; every element with one of them needs an accessible name and a test. */
export const INTERACTIVE_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "combobox",
  "textbox",
  "slider",
  "spinbutton",
] as const;

export type InteractiveRole = (typeof INTERACTIVE_ROLES)[number];

/**
 * `${role}:${name}`, prefixed when the name is shared: a control in a labelled drawer has `<drawer label>/` in
 * front, and a control in a lineage node has `table <id>/`.
 */
export type ControlId = `${InteractiveRole}:${string}`;

const DRAWER = "aside[aria-label]";
const TABLE = "[data-table]";

/**
 * The prefix that tells apart controls that share an accessible name: a drawer's backdrop (the control the drawer
 * renders just before its `aside`) gets `<label>/backdrop `.
 */
const scopeOf = (element: Element): string => {
  const drawer = element.closest(DRAWER);
  if (drawer) {
    return `${drawer.getAttribute("aria-label")}/`;
  }
  const table = element.closest<HTMLElement>(TABLE);
  if (table) {
    return `table ${table.dataset.table}/`;
  }
  const next = element.nextElementSibling;
  return next?.matches(DRAWER)
    ? `${next.getAttribute("aria-label")}/backdrop `
    : "";
};

/** The id of `element`, a control with `role` whose accessible name is `name`. */
export const controlId = (
  role: InteractiveRole,
  name: string,
  element: Element,
): ControlId => `${role}:${scopeOf(element)}${name}`;

/**
 * The ids of the accessible interactive controls in `container`, sorted and without repeats.
 * Throws, naming the role and the element, when one has no accessible name.
 */
export const collectControls = (container: HTMLElement): ControlId[] => {
  const ids = new Set<ControlId>();
  for (const role of INTERACTIVE_ROLES) {
    within(container).queryAllByRole(role, {
      name: (name, element) => {
        if (name.trim() === "") {
          throw new Error(
            `The ${role} has no accessible name: ${element.outerHTML}`,
          );
        }
        ids.add(controlId(role, name, element));
        return true;
      },
    });
  }
  return [...ids].sort();
};

/** A state of a panel: renders it and returns the element to collect the controls from. */
export type ControlState = () => HTMLElement | Promise<HTMLElement>;

/**
 * Builds each state in turn, collects its controls and fails with every id that is not in `tested`,
 * each with the states that showed it.
 */
export const expectControlsCovered = async (
  states: Record<string, ControlState>,
  tested: readonly ControlId[],
): Promise<void> => {
  const missing = new Map<ControlId, string[]>();
  for (const [name, state] of Object.entries(states)) {
    try {
      for (const id of collectControls(await state())) {
        if (!tested.includes(id)) {
          missing.set(id, [...(missing.get(id) ?? []), name]);
        }
      }
    } finally {
      cleanup();
    }
  }
  const lines = [...missing]
    .sort()
    .map(([id, where]) => `  ${id} (in: ${where.join(", ")})`);
  if (lines.length > 0) {
    throw new Error(
      `${lines.length} control(s) have no test:\n${lines.join("\n")}`,
    );
  }
};

/**
 * Waits until the panel posts a message with this `command` and these fields, then asserts it; `syncRequestId` is
 * not compared. A post can land after the awaited user-event call has returned, as `saveDraft` does after Add.
 */
export const expectPosted = async (
  command: string,
  payload: Record<string, unknown> = {},
): Promise<void> => {
  await waitFor(() => {
    const posted = getVsCodeApiMock().postMessage.mock.calls.map(
      ([message]) => message as unknown,
    );
    expect(posted).toContainEqual(
      expect.objectContaining({ command, ...payload }),
    );
  });
};
