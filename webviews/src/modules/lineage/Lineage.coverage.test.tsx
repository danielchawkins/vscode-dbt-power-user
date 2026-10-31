import { screen } from "@testing-library/react";
import { describe, it, vi } from "vitest";
import { expectControlsCovered } from "../../test/controlCoverage";
import {
  activate,
  EMPTY_STATE,
  FANOUT,
  FANOUT_GROUPS,
  HUB,
  node,
  openLineage,
  TABLES,
  TESTED_CONTROLS,
  zoomPast,
} from "../../test/lineageHarness";

// The states render the lineage panel, so its fit runs through the same recording mock as the controls suite.
vi.mock("./fit", async (importOriginal) =>
  (await import("../../test/fitRecorder")).recordingFit(importOriginal),
);

/** Popovers render in a portal, so the controls are collected from the whole page. */
const page = () => document.body;

/** Opens every group of `FANOUT`: its chip row draws three chips and a +2 more button. */
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
        grouped: async () => {
          await openLineage(
            { node: HUB, publication: "s:1" },
            { settings: { maxNeighbours: 2 } },
          );
          return page();
        },
        "group open": async () => {
          const { user } = await openLineage(
            { node: HUB, publication: "s:1" },
            { settings: { maxNeighbours: 2 } },
          );
          await activate(user, "button", "Open staging");
          await screen.findByRole("button", { name: "Close staging" });
          return page();
        },
        overflow: async () => {
          await openOverflow();
          return page();
        },
        "overflow open": async () => {
          const { user, container } = await openOverflow();
          await activate(user, "button", "+2 more", node(container, "fanout"));
          return page();
        },
        "Settings open": stateOf(({ user }) =>
          activate(user, "button", "Settings"),
        ),
        "Connections open": stateOf(({ user }) =>
          activate(user, "button", "Connections"),
        ),
        "Scope open": stateOf(({ user }) => activate(user, "button", "Scope")),
        "busy cards open": async () => {
          const { user } = await openLineage(
            { node: TABLES.b, publication: "s:1" },
            { settings: { maxNeighbours: 1 } },
          );
          await activate(user, "button", "Scope");
          await screen.findByRole("button", { name: "Dim b" });
          return page();
        },
        "Help open": stateOf(({ user }) => activate(user, "button", "Help")),
        "node expanded": stateOf(async ({ user, container }) => {
          await activate(user, "button", "Columns", node(container, "b"));
          await screen.findByRole("button", { name: "id" });
        }),
        "details drawer open": stateOf(async ({ user, container }) => {
          await activate(user, "button", "Details", node(container, "a"));
          await screen.findByRole("button", { name: "Columns (1)" });
        }),
        "zoomed out": stateOf(({ user, container }) =>
          zoomPast(user, container, "Out"),
        ),
        "minimap shown": stateOf(({ user }) =>
          activate(user, "button", "Show minimap"),
        ),
      },
      TESTED_CONTROLS,
    );
    // Twelve renders of the whole panel: 1-3 s alone, past the 5 s default when the suite runs in parallel.
  }, 20_000);
});
