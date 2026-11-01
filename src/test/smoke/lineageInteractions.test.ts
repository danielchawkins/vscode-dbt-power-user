import * as assert from "node:assert";
import * as vscode from "vscode";
import { pollUntil } from "../async";
import { currentFixtureName } from "./fixtureContext";
import {
  expectEdgeGroups,
  expectExclusions,
  expectTransitiveReduction,
} from "./lineageExclusions";
import { setLineageViewMode } from "./lineageViewMode";
import { evaluatePanel } from "./panelFrames";
import { EXTENSION_ID, PANELS } from "./panels";
import { cdpPort, smokeHost } from "./smokeEnv";
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

const LINEAGE: PanelEntry = PANELS.lineage;
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
const host = smokeHost;

/** A table card React Flow draws; the view has drawn the graph once one is present. */
const TABLE_CARD = ".react-flow__node-table";
/** The parents expander of the start node while its parents are shown, e.g. title "Hide 1 parents". */
const SHOWN_PARENTS = `.react-flow__node button[title^="Hide "][title$="parents"]`;

/**
 * Each drawn card's table name, the expander buttons (neighbourhood view) and the plain count bubbles (whole view)
 * with their titles, e.g. "1 parents". A card's counts are read from its own React Flow node.
 */
const READ_EXPANDERS = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const cards = [...document.querySelectorAll("[data-table]")];
  const counts = {};
  for (const card of cards) {
    const scope = card.closest(".react-flow__node") ?? card;
    counts[card.dataset.table.split(".").at(-1)] = [
      ...scope.querySelectorAll("[title$='parents'], [title$='children']"),
    ].map((node) => node.title);
  }
  return {
    entry: "lineage",
    tables: cards.map((card) => card.dataset.table.split(".").at(-1)).sort(),
    expanderButtons: [
      ...document.querySelectorAll(
        ".react-flow__node button[title$='parents'], .react-flow__node button[title$='children']",
      ),
    ].map((button) => button.title),
    counts,
  };
})()`;

interface Expanders {
  entry: string;
  tables: string[];
  expanderButtons: string[];
  counts: Record<string, string[]>;
}

/** The Settings popover's View radio that is checked, its Default expansion input, and its paragraphs of help. */
const READ_SETTINGS = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const dialog = document.querySelector("[role=dialog]");
  const expansion = [...(dialog?.querySelectorAll("label") ?? [])]
    .find((label) => label.textContent.includes("Default expansion"))
    ?.querySelector("input");
  return {
    entry: "lineage",
    viewMode: dialog?.querySelector("input[type=radio][name=view]:checked")?.value ?? null,
    defaultExpansion: expansion
      ? { value: expansion.value, disabled: expansion.disabled, readOnly: expansion.readOnly }
      : null,
    help: [...(dialog?.querySelectorAll("p") ?? [])].map((p) => p.textContent.trim()),
  };
})()`;

interface SettingsState {
  entry: string;
  viewMode: string | null;
  defaultExpansion: {
    value: string;
    disabled: boolean;
    readOnly: boolean;
  } | null;
  help: string[];
}

/** The Scope popover's checkboxes, each with its name and whether it is checked, and the lines of its count. */
const READ_SCOPE = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const section = document.querySelector("section[aria-label=Scope]");
  return {
    entry: "lineage",
    checkboxes: [...(section?.querySelectorAll("input[type=checkbox]") ?? [])].map((input) => ({
      name: input.closest("label").textContent.trim(),
      checked: input.checked,
    })),
    lines: [...(section?.querySelectorAll("p") ?? [])].map((p) => p.textContent.trim()),
  };
})()`;

interface ScopeState {
  entry: string;
  checkboxes: { name: string; checked: boolean }[];
  lines: string[];
}

/** The busy-node list in the Scope popover: its lines (the threshold, or that no card is busy) and each card's text and buttons. */
const READ_BUSY = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const section = document.querySelector("section[aria-label='Busy cards']");
  if (!section) return null;
  return {
    entry: "lineage",
    lines: [...section.querySelectorAll("p")].map((p) => p.textContent.trim()),
    cards: [...section.querySelectorAll("li")].map((item) => ({
      text: item.textContent.trim(),
      buttons: [...item.querySelectorAll("button")].map((button) => button.textContent.trim()),
    })),
  };
})()`;

interface BusyState {
  entry: string;
  lines: string[];
  cards: { text: string; buttons: string[] }[];
}

async function readExpanders(): Promise<Expanders | undefined> {
  return (
    await evaluatePanel<Expanders>(cdpPort(), LINEAGE.entry, READ_EXPANDERS)
  )?.value;
}

async function readSettings(): Promise<SettingsState | undefined> {
  return (
    await evaluatePanel<SettingsState>(cdpPort(), LINEAGE.entry, READ_SETTINGS)
  )?.value;
}

async function readScope(): Promise<ScopeState | undefined> {
  return (await evaluatePanel<ScopeState>(cdpPort(), LINEAGE.entry, READ_SCOPE))
    ?.value;
}

async function readBusy(): Promise<BusyState | undefined> {
  return (await evaluatePanel<BusyState>(cdpPort(), LINEAGE.entry, READ_BUSY))
    ?.value;
}

async function nodeCount(): Promise<number> {
  const match = await evaluatePanel<{ entry: string; nodes: number }>(
    cdpPort(),
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
  await pollUntil(nodeCount, done, {
    timeoutMs: 10_000,
    intervalMs: 250,
    describe: (last) => `${what}; the last node count was ${last}`,
  });
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

    // The default view is the whole project, where Default expansion is shown.
    await openLineage();
    await openSettings();
    await evidence?.capture(LINEAGE, {
      name: "lineage-settings-open",
      expect:
        "Whole project view. Settings popover open under the gear, with the View radios (Whole project checked, " +
        "Neighbourhood), the two edge checkboxes and the Default expansion input with its help text.",
      measured: { popover: "settings", ...(await readSettings()) },
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

    // The Scope popover lists a checkbox per node type and per tag the graph holds, and the count the filters take out.
    await clickInWebview(LINEAGE, { role: "button", name: "Scope" });
    await expectWebviewDom(LINEAGE, { role: "dialog" });
    await expectWebviewDom(LINEAGE, { role: "button", name: "Show all" });
    const scope = await readScope();
    assert.ok(
      scope && scope.checkboxes.length > 0,
      `the Scope popover lists no node type or tag: ${JSON.stringify(scope)}`,
    );
    await evidence?.capture(LINEAGE, {
      name: "lineage-scope-open",
      expect:
        "Whole project view. Scope popover open under its toolbar button, with a checkbox for each node type and tag " +
        "the graph holds, a line counting the cards the filters take out, and a Show all button.",
      measured: { popover: "scope", ...scope },
    });
    // The busy-node list is in the same popover: each busy card ranked by connections, with Soften and Dim, and Hide
    // unless it is the start card; or a line saying the threshold leaves no card busy.
    const busy = await readBusy();
    assert.ok(
      busy && (busy.cards.length > 0 || busy.lines.length > 0),
      `the Scope popover shows no busy-node list: ${JSON.stringify(busy)}`,
    );
    const degrees = busy.cards.map((card) =>
      Number(/(\d+) connections/.exec(card.text)?.[1]),
    );
    assert.ok(
      degrees.every((degree, i) => i === 0 || degrees[i - 1] >= degree),
      `the busy cards are not ranked by connections: ${JSON.stringify(busy.cards)}`,
    );
    for (const card of busy.cards) {
      assert.ok(
        card.buttons.includes("Soften") && card.buttons.includes("Dim"),
        `a busy card lacks Soften or Dim: ${JSON.stringify(card)}`,
      );
    }
    await evidence?.capture(LINEAGE, {
      name: "lineage-busy-cards-open",
      expect:
        "Whole project view. Scope popover open with a Busy cards list under the filters: each busy card ranked by its " +
        "connections, most first, with Soften and Dim, and Hide unless it is the start card; or a line saying no card " +
        "has more connections than the cap.",
      measured: { busy },
    });
    // The Exclusions section sits in the same popover: each rule with the nodes it excludes or the failure dbt gave, a
    // Remove button, and an input with an Add rule button.
    const exclusions = await expectExclusions();
    await evidence?.capture(LINEAGE, {
      name: "lineage-exclusions-open",
      expect:
        "Whole project view. Scope popover open with an Exclusions list under the busy cards' filters: each rule with the " +
        "nodes it excludes or the failure dbt gave, a Remove button per rule, and an input with an Add rule button.",
      measured: { exclusions },
    });
    // The Edge groups section sits in the same popover, above the busy cards: a checkbox per edge kind the graph draws.
    const edgeGroups = await expectEdgeGroups();
    await evidence?.capture(LINEAGE, {
      name: "lineage-edge-groups-open",
      expect:
        "Whole project view. Scope popover open with an Edge groups heading and one on/off checkbox per edge kind the graph draws, all on by default.",
      measured: { edgeGroups },
    });
    // The Transitive reduction checkbox sits under the edge groups, off by default.
    const transitiveReduction = await expectTransitiveReduction();
    await evidence?.capture(LINEAGE, {
      name: "lineage-transitive-reduction-open",
      expect:
        "Whole project view. Scope popover open with a Transitive reduction checkbox under the edge groups, off by default.",
      measured: { transitiveReduction },
    });
    await pressKeyInWebview(LINEAGE, "Escape");
    await expectWebviewDom(LINEAGE, { absent: "[role=dialog]" });

    await clickInWebview(LINEAGE, { role: "button", name: "Help" });
    await expectWebviewDom(LINEAGE, { role: "complementary", name: "Help" });
    await pressKeyInWebview(LINEAGE, "Escape");
    await expectWebviewDom(LINEAGE, { absent: "aside[aria-label=Help]" });

    // The parents expander is a button only in the neighbourhood view, so the view is set for these steps and
    // restored after them, whatever they do.
    await setLineageViewMode("neighbourhood");
    try {
      const defaultNodes = await nodeCount();
      await expectWebviewDom(LINEAGE, { present: SHOWN_PARENTS });
      await evidence?.capture(LINEAGE, {
        name: "lineage-neighbourhood-parents-shown",
        expect:
          "Neighbourhood view. The start card's parents expander is a Hide N parents button, and the graph draws " +
          "only the cards within the depths.",
        measured: {
          viewMode: "neighbourhood",
          nodes: defaultNodes,
          ...(await readExpanders()),
        },
      });
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
    } finally {
      await setLineageViewMode("whole");
    }
  });

  test("draws the whole project by default, with counts and no expander", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openLineage();
    const whole = await pollUntil(
      readExpanders,
      (state) => state?.tables.length === 3,
      {
        timeoutMs: 10_000,
        intervalMs: 250,
        describe: (last) =>
          `the whole project should draw three tables; the last state was ${JSON.stringify(last)}`,
      },
    );
    assert.ok(whole, "the lineage view did not answer");
    assert.deepStrictEqual(whole.tables, ["broken_ref", "child", "with_ctes"]);
    assert.deepStrictEqual(
      whole.expanderButtons,
      [],
      "the whole project should show no Show or Hide expander button",
    );
    assert.ok(
      whole.counts.child?.includes("1 parents"),
      `child should show its parent count as plain text: ${JSON.stringify(whole.counts)}`,
    );
    await evidence?.capture(LINEAGE, {
      name: "lineage-whole-default",
      expect:
        "Whole project view on open: broken_ref, child and with_ctes drawn, each card showing its parents and " +
        "children as plain counts with no Show or Hide expander button.",
      measured: { viewMode: "whole", ...whole },
    });

    await openSettings();
    const settings = await readSettings();
    assert.strictEqual(
      settings?.viewMode,
      "whole",
      "the Whole project radio should be checked",
    );
    assert.ok(
      settings?.defaultExpansion,
      "the whole view should show Default expansion",
    );
    assert.strictEqual(
      settings.defaultExpansion.disabled,
      false,
      "Default expansion should be enabled in the whole view",
    );
    assert.ok(
      settings.help.some((text) => text.includes("Default expansion")),
      `Default expansion should be explained: ${JSON.stringify(settings.help)}`,
    );
    await clickInWebview(LINEAGE, gear);
    await expectSettingsClosed();
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
