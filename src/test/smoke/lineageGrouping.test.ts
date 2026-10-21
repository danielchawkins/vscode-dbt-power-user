import * as assert from "node:assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import {
  evaluatePanel,
  validateSmokeHost,
  waitForPanelGone,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  expectWebviewDom,
  interactionEvidence,
  showPanel,
} from "./webviewInteractions";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const LINEAGE: PanelEntry = {
  container: "workbench.view.extension.lineage_view",
  command: "fusionPowerUser.Lineage.focus",
  entry: "lineage",
};
const HUB = "hub";
const MIN_WEBVIEW_HEIGHT = 480;

const runsHere = () => currentFixtureName() === "lineage-groups";
const host = () =>
  validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");

/** What the lineage webview draws now: group nodes with their counts, table cards, group chips and "+N" buttons. */
interface Snapshot {
  entry: string;
  groups: { label: string; count: string }[];
  cards: string[];
  chips: { label: string; text: string }[];
  more: string[];
}

const SNAPSHOT = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  groups: [...document.querySelectorAll("[data-group]")].map((el) => {
    const spans = el.querySelectorAll("span");
    return { label: el.dataset.group, count: spans[1]?.textContent ?? "" };
  }),
  cards: [...document.querySelectorAll("[data-table]")].map((el) => el.dataset.table.split(".").at(-1)),
  chips: [...document.querySelectorAll('button[aria-label^="Close "]')].map((button) => ({
    label: button.getAttribute("aria-label").slice("Close ".length),
    text: button.parentElement?.textContent ?? "",
  })),
  more: [...document.querySelectorAll('button[aria-label^="Show "][aria-label*=" more "]')].map(
    (button) => button.getAttribute("aria-label"),
  ),
} : null)()`;

async function snapshot(): Promise<Snapshot> {
  const match = await evaluatePanel<Snapshot>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    SNAPSHOT,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Polls the webview until `done` holds for its snapshot, and fails with the last snapshot otherwise. */
async function waitForSnapshot(
  what: string,
  done: (current: Snapshot) => boolean,
): Promise<Snapshot> {
  const deadline = Date.now() + 10_000;
  let last = await snapshot();
  while (!done(last)) {
    if (Date.now() >= deadline) {
      throw new Error(`${what}; the last snapshot was ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await snapshot();
  }
  return last;
}

async function webviewHeight(): Promise<number> {
  const match = await evaluatePanel<{ entry: string; height: number }>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    `(() => document.body.dataset.entry === "lineage" ? { entry: "lineage", height: innerHeight } : null)()`,
  );
  return match?.value.height ?? 0;
}

/** Whether this suite has changed the bottom panel's maximized state, so the teardown can put it back. */
let panelToggled = false;

async function toggleMaximizedPanel(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.toggleMaximizedPanel");
  panelToggled = !panelToggled;
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}

/** Opens the hub model, so the lineage view starts from it, and shows the tall lineage panel. */
async function openHub(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "the fixture folder is open");
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(root, "models", `${HUB}.sql`),
    ),
  );
  const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  await api.ready;
  await showPanel(LINEAGE);
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((await webviewHeight()) >= MIN_WEBVIEW_HEIGHT) {
      return;
    }
    await toggleMaximizedPanel();
  }
}

const CHILDREN_EXPANDER = { role: "button", name: "Show 7 children" };

/**
 * Waits for the hub's children expander and returns its label. The view may expand the children on its own once the
 * graph loads ("Hide 7 children"), or leave them for a click ("Show 7 children"); either way the view reports it.
 */
const CHILDREN_STATE = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  labels: [...document.querySelectorAll("button[aria-label]")].map((button) => button.getAttribute("aria-label")),
  text: document.body.innerText.slice(0, 400),
} : null)()`;

async function waitForChildrenExpander(): Promise<string> {
  const deadline = Date.now() + 60_000;
  let last: { labels: string[]; text: string } | undefined;
  while (Date.now() < deadline) {
    const match = await evaluatePanel<{
      entry: string;
      labels: string[];
      text: string;
    }>(process.env.FPU_CDP_PORT!, LINEAGE.entry, CHILDREN_STATE);
    last = match?.value;
    const label = last?.labels.find((l) => /^(Show|Hide) 7 children$/.test(l));
    if (label) {
      return label;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `the hub's children expander never appeared in the lineage view; the view showed ${JSON.stringify(last ?? null)}`,
  );
}

/**
 * The canvas zoom and, per table card, its unscaled size, the header's badge and title font sizes, the subtitle's
 * display, and the visibility of every other row under the header.
 */
interface ZoomState {
  entry: string;
  zoom: number;
  cards: {
    width: number;
    height: number;
    badge: number;
    title: number;
    subtitle: string;
    rows: string[];
  }[];
}

const ZOOM_STATE = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  zoom: Number(
    /scale\\(([\\d.]+)\\)/.exec(document.querySelector(".react-flow__viewport")?.style.transform ?? "")?.[1],
  ),
  cards: [...document.querySelectorAll("[data-table]")].map((card) => {
    const [badge, title, , subtitle] = card.querySelectorAll(":scope > div:first-child > span");
    return {
      width: card.offsetWidth,
      height: card.offsetHeight,
      badge: parseFloat(getComputedStyle(badge).fontSize),
      title: parseFloat(getComputedStyle(title).fontSize),
      subtitle: getComputedStyle(subtitle).display,
      rows: [...card.querySelectorAll(":scope > :not(:first-child)")].map((row) => getComputedStyle(row).visibility),
    };
  }),
} : null)()`;

async function zoomState(): Promise<ZoomState> {
  const match = await evaluatePanel<ZoomState>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    ZOOM_STATE,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Presses Zoom Out until the canvas zoom is below 50%, and returns the state then. */
async function zoomOutBelowHalf(): Promise<ZoomState> {
  const deadline = Date.now() + 20_000;
  let last = await zoomState();
  while (last.zoom >= 0.5 || Number.isNaN(last.zoom)) {
    if (Date.now() >= deadline) {
      throw new Error(`the zoom stayed at ${last.zoom}`);
    }
    await clickInWebview(LINEAGE, { role: "button", name: "Zoom Out" });
    await new Promise((resolve) => setTimeout(resolve, 400));
    last = await zoomState();
  }
  return last;
}

/** Each card's id (its last segment) with the title text its header shows. */
const CARD_TITLES = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  titles: Object.fromEntries([...document.querySelectorAll("[data-table]")].map((el) => [
    el.dataset.table.split(".").at(-1),
    el.querySelector('span[title^="' + el.dataset.table + '"]')?.textContent ?? "",
  ])),
} : null)()`;

async function cardTitles(): Promise<Record<string, string>> {
  const match = await evaluatePanel<{
    entry: string;
    titles: Record<string, string>;
  }>(process.env.FPU_CDP_PORT!, LINEAGE.entry, CARD_TITLES);
  assert.ok(match, "the lineage webview is not showing");
  return match.value.titles;
}

/** Hides the lineage panel so its page is rebuilt, which reads the settings again, then shows it from the hub. */
async function reopenHub(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await waitForPanelGone(process.env.FPU_CDP_PORT!, LINEAGE.entry);
  await openHub();
}

suite("Lineage grouping", function () {
  this.timeout(300_000);

  // The suite's teardown runs when this suite ends, so later suites start with the default bottom panel.
  suiteTeardown(async function () {
    if (panelToggled) {
      await toggleMaximizedPanel();
    }
  });

  test("groups the hub's children by folder, then opens a group into cards and a chip", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openHub();
    if ((await waitForChildrenExpander()) === "Show 7 children") {
      await clickInWebview(LINEAGE, CHILDREN_EXPANDER);
    }
    const grouped = await waitForSnapshot(
      "the hub's children should draw two group nodes and the marts card, with no +N button",
      (current) =>
        current.groups.length === 2 && current.cards.includes("mart_summary"),
    );
    assert.deepStrictEqual(grouped.groups, [
      { label: "a", count: "3" },
      { label: "b", count: "3" },
    ]);
    assert.deepStrictEqual(grouped.more, []);
    assert.deepStrictEqual(grouped.chips, []);
    // After the expansion the group nodes can sit past the right edge of the narrow panel; Fit View brings them into view.
    await clickInWebview(LINEAGE, { role: "button", name: "Fit View" });
    await evidence?.capture(LINEAGE, {
      name: "lineage-groups-closed",
      expect:
        "Hub with its children expanded: two closed group nodes, 'a' with 3 and 'b' with 3, and one marts card; no +K button anywhere.",
      measured: {
        groups: grouped.groups,
        cards: grouped.cards,
        more: grouped.more,
      },
    });

    await clickInWebview(LINEAGE, { role: "button", name: "Open a" });
    const opened = await waitForSnapshot(
      "opening group a should draw its three cards and an 'a' chip on the hub",
      (current) =>
        ["stg_a_1", "stg_a_2", "stg_a_3"].every((name) =>
          current.cards.includes(name),
        ) && current.chips.some((chip) => chip.label === "a"),
    );
    assert.deepStrictEqual(
      opened.groups.map((group) => group.label),
      ["b"],
    );
    const chip = opened.chips.find((candidate) => candidate.label === "a");
    assert.ok(chip?.text.includes("3/3"), `chip text was ${chip?.text}`);
    assert.deepStrictEqual(opened.more, []);
    await expectWebviewDom(LINEAGE, { role: "button", name: "Open b" });
    await evidence?.capture(LINEAGE, {
      name: "lineage-groups-opened",
      expect:
        "After opening group a: three stg_a cards, the group b node still closed, the marts card, and an 'a' chip on the hub reading 3/3 with no +K button.",
      measured: {
        cards: opened.cards,
        groups: opened.groups,
        chips: opened.chips,
        more: opened.more,
      },
    });

    // Checkpoint 3: zoomed out, cards keep their size and show a larger badge and title only.
    const before = await zoomState();
    const zoomed = await zoomOutBelowHalf();
    assert.ok(zoomed.zoom < 0.5, `the zoom was ${zoomed.zoom}`);
    assert.ok(zoomed.cards.length > 0, "the zoomed-out canvas draws cards");
    assert.deepStrictEqual(
      zoomed.cards.map(({ width, height }) => [width, height]),
      before.cards.map(({ width, height }) => [width, height]),
      "each card keeps its size",
    );
    for (const card of zoomed.cards) {
      assert.ok(card.title >= 26, `title was ${card.title}px`);
      assert.ok(card.badge >= 20, `badge was ${card.badge}px`);
      assert.strictEqual(card.subtitle, "none");
      assert.ok(
        card.rows.every((visibility) => visibility === "hidden"),
        `rows under the header were ${card.rows.join(",")}`,
      );
    }
    await evidence?.capture(LINEAGE, {
      name: "lineage-groups-zoomed-out",
      expect:
        "The same graph zoomed out below 50%: every card keeps its size and shows only a larger badge and title, " +
        "with no subtitle line, action row or columns.",
      measured: {
        zoom: zoomed.zoom,
        sizesBefore: before.cards.map(({ width, height }) => [width, height]),
        cards: zoomed.cards,
      },
    });
  });

  // Checkpoint 4: with lineage.title set to name, cards show the dbt name, not the alias.
  test("titles cards by dbt name when lineage.title is name", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());
    const config = vscode.workspace.getConfiguration("fusionPowerUser");
    // In alias mode, the default, the fixture's aliased marts model is titled by its alias.
    await reopenHub();
    if ((await waitForChildrenExpander()) === "Show 7 children") {
      await clickInWebview(LINEAGE, CHILDREN_EXPANDER);
    }
    await waitForSnapshot(
      "the hub's children should draw the marts card",
      (current) => current.cards.includes("mart_summary"),
    );
    const aliasTitles = await cardTitles();
    assert.strictEqual(
      aliasTitles.mart_summary,
      "summary_mart",
      `in alias mode the titles were ${JSON.stringify(aliasTitles)}`,
    );
    try {
      await config.update(
        "lineage.title",
        "name",
        vscode.ConfigurationTarget.Workspace,
      );
      await reopenHub();
      if ((await waitForChildrenExpander()) === "Show 7 children") {
        await clickInWebview(LINEAGE, CHILDREN_EXPANDER);
      }
      await waitForSnapshot(
        "the hub's children should draw the marts card",
        (current) => current.cards.includes("mart_summary"),
      );
      const deadline = Date.now() + 10_000;
      let titles = await cardTitles();
      while (titles.mart_summary !== "mart_summary") {
        if (Date.now() >= deadline) {
          throw new Error(`the titles were ${JSON.stringify(titles)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        titles = await cardTitles();
      }
      assert.ok(
        !Object.values(titles).includes("summary_mart"),
        `the alias still titled a card: ${JSON.stringify(titles)}`,
      );
      await clickInWebview(LINEAGE, { role: "button", name: "Fit View" });
      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-name-mode",
        expect:
          "The hub's children expanded with lineage.title set to name: the marts card is titled mart_summary, " +
          "not its alias summary_mart.",
        measured: { aliasTitles, titles },
      });
    } finally {
      await config.update(
        "lineage.title",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });
});
