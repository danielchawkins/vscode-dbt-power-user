import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { evaluatePanel, validateSmokeHost } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  clickWebviewPoint,
  expectWebviewDom,
  interactionEvidence,
  isWebviewChecked,
  maximizePanelFor,
  pressKeyInWebview,
  restorePanelSize,
  showPanel,
} from "./webviewInteractions";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const LINEAGE: PanelEntry = {
  container: "workbench.view.extension.lineage_view",
  command: "fusionPowerUser.Lineage.focus",
  entry: "lineage",
};
const SETTINGS_CHECKBOXES = [
  "Show select (direct) column edges",
  "Show non-select (indirect) column edges",
];
const RELATIONSHIP_CHECKBOXES = [
  "test",
  "contract",
  "meta",
  "semantic",
  "Infer relationships for sources",
];

const runsHere = () => currentFixtureName() === "single-project";
const host = () =>
  validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");

/** A table card React Flow draws; the view has drawn the graph once one is present. */
const TABLE_CARD = ".react-flow__node-table";
/** The parents expander of the start node while its parents are shown, e.g. title "Hide 1 parents". */
const SHOWN_PARENTS = `.react-flow__node button[title^="Hide "][title$="parents"]`;

async function nodeCount(): Promise<number> {
  const match = await evaluatePanel<{ entry: string; nodes: number }>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    `(() => document.body.dataset.entry === "lineage"
      ? { entry: "lineage", nodes: document.querySelectorAll(".react-flow__node").length }
      : null)()`,
  );
  return match?.value.nodes ?? -1;
}

async function openLineage(): Promise<void> {
  const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  await api.ready;
  await showPanel(LINEAGE);
  // Tall enough for the Connections popover and its last checkbox; the default bottom panel is shorter.
  await maximizePanelFor(LINEAGE.entry);
  try {
    await expectWebviewDom(LINEAGE, { present: TABLE_CARD });
  } catch (error) {
    throw new Error(
      `the lineage view drew no table card before the test acted: ${(error as Error).message}`,
    );
  }
}

/** Polls the node count until `done` holds, and fails with the last count otherwise. */
async function waitForNodeCount(
  what: string,
  done: (count: number) => boolean,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  let last = -1;
  do {
    last = await nodeCount();
    if (done(last)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`${what}; the last node count was ${last}`);
}

const gear = { role: "button", name: "Settings" };

async function openSettings(): Promise<void> {
  await clickInWebview(LINEAGE, gear);
  await expectWebviewDom(LINEAGE, { role: "dialog" });
  await expectWebviewDom(LINEAGE, { ...gear, expanded: true });
}

/** No popover is left, and the gear reports that Settings is closed. */
async function expectSettingsClosed(): Promise<void> {
  await expectWebviewDom(LINEAGE, { absent: "[role=dialog]" });
  await expectWebviewDom(LINEAGE, { ...gear, expanded: false });
}

/** Clicks the checkbox, checks it flipped, clicks again, and checks it is back where it started. */
async function toggleTwice(name: string): Promise<void> {
  const initial = await isWebviewChecked(LINEAGE, name);
  const checkbox = { role: "checkbox", name };
  await clickInWebview(LINEAGE, checkbox);
  await expectWebviewDom(LINEAGE, { ...checkbox, checked: !initial });
  await expectWebviewDom(LINEAGE, { role: "dialog" });
  await clickInWebview(LINEAGE, checkbox);
  await expectWebviewDom(LINEAGE, { ...checkbox, checked: initial });
}

suite("Lineage interactions", function () {
  this.timeout(300_000);

  // The suite's teardown runs when this suite ends, so later suites start with the default bottom panel.
  suiteTeardown(async function () {
    await restorePanelSize();
  });

  test("clicks every toolbar control and each popover's main controls", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openLineage();
    await openSettings();
    await evidence?.capture(LINEAGE, {
      name: "lineage-settings-open",
      expect:
        "Settings popover open under the gear; its two edge checkboxes and the default expansion input.",
      measured: { popover: "settings" },
    });
    for (const name of SETTINGS_CHECKBOXES) {
      await toggleTwice(name);
    }
    await clickInWebview(LINEAGE, {
      role: "spinbutton",
      name: "Default expansion",
    });
    await expectWebviewDom(LINEAGE, { role: "dialog" });
    await clickInWebview(LINEAGE, gear);
    await expectSettingsClosed();

    await clickInWebview(LINEAGE, { role: "button", name: "Connections" });
    await expectWebviewDom(LINEAGE, { role: "dialog" });
    await expectWebviewDom(LINEAGE, {
      role: "radiogroup",
      name: "Connections",
    });
    for (const value of ["dbt", "declared", "both"]) {
      await expectWebviewDom(LINEAGE, {
        present: `input[type=radio][name=connections][value=${value}]`,
      });
    }
    await evidence?.capture(LINEAGE, {
      name: "lineage-relationships-open",
      expect:
        "Connections popover open under its toolbar button; the dbt dependencies, Declared relationships and Both " +
        "radios listed, with the relationship and inference checkboxes.",
      measured: { popover: "relationships" },
    });
    for (const name of RELATIONSHIP_CHECKBOXES) {
      await toggleTwice(name);
    }
    await pressKeyInWebview(LINEAGE, "Escape");
    await expectWebviewDom(LINEAGE, { absent: "[role=dialog]" });

    await clickInWebview(LINEAGE, { role: "button", name: "Help" });
    await expectWebviewDom(LINEAGE, { role: "complementary", name: "Help" });
    await pressKeyInWebview(LINEAGE, "Escape");
    await expectWebviewDom(LINEAGE, { absent: "aside[aria-label=Help]" });

    const defaultNodes = await nodeCount();
    await clickWebviewPoint(LINEAGE, { selector: SHOWN_PARENTS });
    await waitForNodeCount(
      "hiding the parents did not remove any nodes",
      (count) => count < defaultNodes,
    );
    await clickInWebview(LINEAGE, { role: "button", name: "Reset" });
    await waitForNodeCount(
      "Reset did not restore the default expansion",
      (count) => count === defaultNodes,
    );
  });

  test("closes Settings on a click in the pane", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openLineage();
    await openSettings();
    await clickWebviewPoint(LINEAGE, {
      selector: ".react-flow__pane",
      offset: [10, 10],
    });
    await expectSettingsClosed();
    await evidence?.capture(LINEAGE, {
      name: "lineage-settings-closed-pane-click",
      expect:
        "Lineage graph with no popover; the Settings gear is not pressed.",
      measured: { closedBy: "pane click" },
    });
  });

  test("closes Settings on a second click on the gear", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openLineage();
    await openSettings();
    await clickInWebview(LINEAGE, gear);
    await expectSettingsClosed();
    await evidence?.capture(LINEAGE, {
      name: "lineage-settings-closed-gear-click",
      expect:
        "Lineage graph with no popover; the Settings gear is not pressed.",
      measured: { closedBy: "second gear click" },
    });
  });

  test("closes Settings on Escape and returns focus to the gear", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openLineage();
    await openSettings();
    await pressKeyInWebview(LINEAGE, "Escape");
    await expectSettingsClosed();
    await expectWebviewDom(LINEAGE, { ...gear, focused: true });
    await evidence?.capture(LINEAGE, {
      name: "lineage-settings-closed-escape",
      expect:
        "Lineage graph with no popover; the Settings gear is not pressed and has focus.",
      measured: { closedBy: "Escape" },
    });
  });
});
