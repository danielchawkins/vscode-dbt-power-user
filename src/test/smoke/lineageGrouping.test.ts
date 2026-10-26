import * as assert from "node:assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import {
  evaluatePanel,
  validateSmokeHost,
  waitForPanelGone,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import type { ColumnState } from "./lineageProbes";
import {
  clickFirstColumn,
  clickOnCard,
  readColumns,
  tracedCardsListed,
} from "./lineageProbes";
import { EXTENSION_ID, PANELS } from "./panels";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  expectWebviewDom,
  interactionEvidence,
  maximizePanelFor,
  restorePanelSize,
  showPanel,
  zoomPastHalf,
  zoomState,
} from "./webviewInteractions";

const LINEAGE: PanelEntry = PANELS.lineage;
const HUB = "hub";
const HUB_CHILDREN = 7;

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
  groups: [...document.querySelectorAll("[data-group]")].map((el) => ({
    label: el.dataset.group,
    count: el.querySelector("[data-group-count]")?.textContent ?? "",
  })),
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

/** Opens the named model, so the lineage view starts from it, and shows the tall lineage panel. */
async function openModel(name: string): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "the fixture folder is open");
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(root, "models", `${name}.sql`),
    ),
  );
  const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  await api.ready;
  await showPanel(LINEAGE);
  await maximizePanelFor(LINEAGE.entry);
}

const childrenExpander = (count: number) => ({
  role: "button",
  name: `Show ${count} children`,
});

/**
 * Waits for the children expander with `count` children and returns its label. The view may expand the children on its own
 * once the graph loads ("Hide N children"), or leave them for a click ("Show N children"); either way the view reports it.
 */
const CHILDREN_STATE = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  labels: [...document.querySelectorAll("button[aria-label]")].map((button) => button.getAttribute("aria-label")),
  text: document.body.innerText.slice(0, 400),
} : null)()`;

async function waitForChildrenExpander(count: number): Promise<string> {
  const deadline = Date.now() + 60_000;
  let last: { labels: string[]; text: string } | undefined;
  while (Date.now() < deadline) {
    const match = await evaluatePanel<{
      entry: string;
      labels: string[];
      text: string;
    }>(process.env.FPU_CDP_PORT!, LINEAGE.entry, CHILDREN_STATE);
    last = match?.value;
    const label = last?.labels.find(
      (l) => l === `Show ${count} children` || l === `Hide ${count} children`,
    );
    if (label) {
      return label;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `the children expander with ${count} children never appeared in the lineage view; the view showed ${JSON.stringify(last ?? null)}`,
  );
}

/** Each card's id (its last segment) with the title text its header shows. */
const CARD_TITLES = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  titles: Object.fromEntries([...document.querySelectorAll("[data-table]")].map((el) => [
    el.dataset.table.split(".").at(-1),
    el.querySelector('span[title^="' + el.dataset.table + '"] > span:first-child')?.textContent ?? "",
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

/** The layer name of every layer band the layered layout draws, in draw order. */
const BAND_LABELS = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  bands: [...document.querySelectorAll(".react-flow__node-band [data-layer]")].map((el) => el.dataset.layer),
} : null)()`;

async function bandLabels(): Promise<string[]> {
  const match = await evaluatePanel<{ entry: string; bands: string[] }>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    BAND_LABELS,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value.bands;
}

/** Hides the lineage panel so its page is rebuilt, which reads the settings again, then shows it from the named model. */
async function reopenModel(name: string): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closePanel");
  await waitForPanelGone(process.env.FPU_CDP_PORT!, LINEAGE.entry);
  await openModel(name);
}

const FANOUT = "fanout";
const FANOUT_CHILDREN = 10;
/** The fixture's `fusionPowerUser.lineage.maxNeighbours`: how many children a capped expansion draws at first. */
const DRAWN_CHILDREN = 3;

/**
 * The fanout card's children expander label, its "+N" overflow buttons, and how many children cards the view draws
 * outside it.
 */
interface FanoutCard {
  entry: string;
  expander: string | null;
  overflow: string[];
  children: number;
}

const FANOUT_CARD = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  expander: document
    .querySelector('[data-table$=".${FANOUT}"] button[aria-label$=" children"]:not([aria-label*=" more "])')
    ?.getAttribute("aria-label") ?? null,
  overflow: [...document.querySelectorAll('[data-table$=".${FANOUT}"] button[aria-label*=" more children"]')].map(
    (button) => button.getAttribute("aria-label"),
  ),
  children: document.querySelectorAll('[data-table]:not([data-table$=".${FANOUT}"])').length,
} : null)()`;

async function fanoutCard(): Promise<FanoutCard> {
  const match = await evaluatePanel<FanoutCard>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    FANOUT_CARD,
  );
  assert.ok(match, "the lineage webview is not showing");
  return match.value;
}

/** Polls the fanout card until `done` holds, and fails with the last reading otherwise. */
async function waitForFanoutCard(
  what: string,
  done: (current: FanoutCard) => boolean,
): Promise<FanoutCard> {
  const deadline = Date.now() + 10_000;
  let last = await fanoutCard();
  while (!done(last)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `${what}; the last fanout card was ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await fanoutCard();
  }
  return last;
}

const readHub = () => readColumns(HUB);

/** Polls the column state until `done` holds, and fails with the last state otherwise. */
async function waitForColumns(
  what: string,
  done: (current: ColumnState) => boolean,
): Promise<ColumnState> {
  const deadline = Date.now() + 10_000;
  let last = await readHub();
  while (!done(last)) {
    if (Date.now() >= deadline) {
      throw new Error(`${what}; the last state was ${JSON.stringify(last)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await readHub();
  }
  return last;
}

/**
 * Opens the hub card's column list, clicking "Columns" only while the list is closed, then clicks its first column.
 * Returns the column state once the click has traced an edge.
 */
async function traceHubColumn(): Promise<ColumnState> {
  const deadline = Date.now() + 10_000;
  let state = await readHub();
  while (!state.columnTables.includes(HUB)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `the hub card's column list did not open; the last state was ${JSON.stringify(state)}`,
      );
    }
    await evaluatePanel(
      process.env.FPU_CDP_PORT!,
      LINEAGE.entry,
      clickOnCard(HUB, "Columns"),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    state = await readHub();
  }
  await waitForColumns(
    "the hub card should list its columns",
    (current) => current.cardColumns > 0,
  );
  const clicked = await evaluatePanel<{ entry: string; clicked: boolean }>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    clickFirstColumn(HUB),
  );
  assert.ok(clicked?.value.clicked, "the hub card has a column row to click");
  // The baseline is the first pair of equal reads once every traced card lists its columns.
  let previous: string | undefined;
  return waitForColumns(
    "clicking a hub column should trace column edges that hold still",
    (current) => {
      const key = JSON.stringify([current.traced, current.tableD]);
      const stable =
        current.traced.length > 0 &&
        tracedCardsListed(current) &&
        key === previous;
      previous = key;
      return stable;
    },
  );
}

/**
 * Each group card's computed border and fill, and the layer band whose rectangle holds the card's centre,
 * with that band's own colour behind the card.
 */
const GROUP_STYLES = `(() => document.body.dataset.entry === "lineage" ? {
  entry: "lineage",
  groups: [...document.querySelectorAll("[data-group]")].map((card) => {
    const style = getComputedStyle(card);
    const box = card.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const band = [...document.querySelectorAll("[data-layer]")].find((candidate) => {
      const edge = candidate.getBoundingClientRect();
      return x >= edge.left && x <= edge.right && y >= edge.top && y <= edge.bottom;
    });
    return {
      label: card.getAttribute("data-group"),
      borderColor: style.borderTopColor,
      borderStyle: style.borderTopStyle,
      background: style.backgroundColor,
      band: band
        ? {
            layer: band.getAttribute("data-layer"),
            colour: getComputedStyle(band).getPropertyValue("--band-colour").trim(),
            background: getComputedStyle(band).backgroundColor,
          }
        : null,
    };
  }),
} : null)()`;

async function groupStyles(): Promise<unknown> {
  const match = await evaluatePanel<{ entry: string; groups: unknown[] }>(
    process.env.FPU_CDP_PORT!,
    LINEAGE.entry,
    GROUP_STYLES,
  );
  return match?.value.groups ?? [];
}

suite("Lineage grouping", function () {
  this.timeout(300_000);

  // The suite's teardown runs when this suite ends, so later suites start with the default bottom panel.
  suiteTeardown(async function () {
    await restorePanelSize();
  });

  test("groups the hub's children by folder, then opens a group into cards and a chip", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    await openModel(HUB);
    if (
      (await waitForChildrenExpander(HUB_CHILDREN)) ===
      `Show ${HUB_CHILDREN} children`
    ) {
      await clickInWebview(LINEAGE, childrenExpander(HUB_CHILDREN));
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
    const styles = await groupStyles();
    await evidence?.capture(LINEAGE, {
      name: "lineage-groups-closed",
      expect:
        "Hub with its children expanded: two closed group nodes, 'a' with 3 and 'b' with 3, and one marts card; no +K button anywhere. Each group's border, fill and the band behind it are recorded.",
      measured: {
        groups: grouped.groups,
        cards: grouped.cards,
        more: grouped.more,
        groupStyles: styles,
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

    // The layered layout draws a band per layer run behind the cards; the checkpoint records the band labels and titles.
    const bands = await bandLabels();
    assert.ok(bands.length > 0, "the layered layout should draw layer bands");
    await evidence?.capture(LINEAGE, {
      name: "lineage-groups-layered",
      expect:
        "The opened graph in layered mode: a layer band behind each layer run, labelled with its layer name, and every card titled.",
      measured: { bands, titles: await cardTitles() },
    });

    // Checkpoint 3: zoomed out, cards keep their size and show a larger title and a wider layer stripe only.
    const before = await zoomState(LINEAGE);
    const zoomed = await zoomPastHalf(LINEAGE, "out");
    assert.ok(zoomed.zoom < 0.5, `the zoom was ${zoomed.zoom}`);
    assert.ok(zoomed.cards.length > 0, "the zoomed-out canvas draws cards");
    assert.deepStrictEqual(
      zoomed.cards.map(({ width, height }) => [width, height]),
      before.cards.map(({ width, height }) => [width, height]),
      "each card keeps its size",
    );
    for (const card of zoomed.cards) {
      assert.ok(card.title >= 26, `title was ${card.title}px`);
      assert.ok(
        card.stripe === 0 || card.stripe >= 12,
        `the layer stripe was ${card.stripe}px`,
      );
      assert.ok(
        card.subtitle === "hidden" || card.subtitle === "absent",
        `the subtitle was ${card.subtitle}`,
      );
      assert.ok(
        card.rows.every((visibility) => visibility === "hidden"),
        `rows under the header were ${card.rows.join(",")}`,
      );
    }
    await evidence?.capture(LINEAGE, {
      name: "lineage-groups-zoomed-out",
      expect:
        "The same graph zoomed out below 50%: every card keeps its size and shows only a larger title and a wider " +
        "layer stripe, with no subtitle line, action row, expander bubble or columns.",
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
    await reopenModel(HUB);
    if (
      (await waitForChildrenExpander(HUB_CHILDREN)) ===
      `Show ${HUB_CHILDREN} children`
    ) {
      await clickInWebview(LINEAGE, childrenExpander(HUB_CHILDREN));
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
      await reopenModel(HUB);
      if (
        (await waitForChildrenExpander(HUB_CHILDREN)) ===
        `Show ${HUB_CHILDREN} children`
      ) {
        await clickInWebview(LINEAGE, childrenExpander(HUB_CHILDREN));
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

  // Checkpoints 5 to 7: in the leftToRight layout, a traced column's edges follow the zoom, the table edges do not.
  test("traces hub.id to mart_summary in leftToRight, drops the column edges zoomed out, and redraws them zoomed in", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());
    const config = vscode.workspace.getConfiguration("fusionPowerUser");
    try {
      await config.update(
        "lineage.layout",
        "leftToRight",
        vscode.ConfigurationTarget.Workspace,
      );
      await reopenModel(HUB);
      if (
        (await waitForChildrenExpander(HUB_CHILDREN)) ===
        `Show ${HUB_CHILDREN} children`
      ) {
        await clickInWebview(LINEAGE, childrenExpander(HUB_CHILDREN));
      }
      await waitForSnapshot(
        "the hub's children should draw the marts card",
        (current) => current.cards.includes("mart_summary"),
      );
      // Column edges are only drawn from 50% zoom up, so start there.
      await zoomPastHalf(LINEAGE, "in");
      const traced = await traceHubColumn();
      assert.ok(
        traced.traced.some((id) => id.includes("mart_summary")),
        `no traced edge reaches mart_summary: ${JSON.stringify(traced.traced)}`,
      );
      const tracedBefore = traced.traced.length;
      const tableDBefore = traced.tableD;
      assert.ok(tableDBefore.length > 0, "the canvas draws table edges");

      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-ltr-trace",
        expect:
          "The leftToRight layout with the hub's Columns list open and its id column clicked: column edges run from " +
          "that column to the marts card, alongside the table edges. The traced edge ids and table edge paths are in " +
          "measured.",
        measured: { traced: traced.traced, tableD: traced.tableD },
      });

      await zoomPastHalf(LINEAGE, "out");
      const zoomedOut = await readHub();
      assert.strictEqual(
        zoomedOut.traced.length,
        0,
        `the zoomed-out canvas still draws column edges: ${JSON.stringify(zoomedOut.traced)}`,
      );
      assert.deepStrictEqual(zoomedOut.tableD, tableDBefore);

      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-ltr-trace-zoomed-out",
        expect:
          "The same leftToRight graph zoomed out below 50%: the column edges are gone, and the table edges keep " +
          "their paths, the same as before the zoom.",
        measured: { traced: zoomedOut.traced, tableD: zoomedOut.tableD },
      });

      await zoomPastHalf(LINEAGE, "in");
      const zoomedIn = await waitForColumns(
        "zooming back in should draw the column edges again",
        (current) => current.traced.length === tracedBefore,
      );
      assert.deepStrictEqual(zoomedIn.tableD, tableDBefore);

      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-ltr-trace-zoomed-in",
        expect:
          "Zoomed back to 50% or more: the column edges come back, the same number as before the zoom out, and the " +
          "table edges still keep their paths.",
        measured: { traced: zoomedIn.traced, tableD: zoomedIn.tableD },
      });
    } finally {
      await config.update(
        "lineage.layout",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });

  // Checkpoints 8 to 10: without folder groups a capped expansion draws its first maxNeighbours children and a "+N" button.
  test("caps a fanout card's children and opens and closes the overflow", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());
    const config = vscode.workspace.getConfiguration("fusionPowerUser");
    const overflow = FANOUT_CHILDREN - DRAWN_CHILDREN;
    try {
      await config.update(
        "lineage.groupBy",
        "none",
        vscode.ConfigurationTarget.Workspace,
      );
      await reopenModel(FANOUT);
      if (
        (await waitForChildrenExpander(FANOUT_CHILDREN)) ===
        `Show ${FANOUT_CHILDREN} children`
      ) {
        await clickInWebview(LINEAGE, childrenExpander(FANOUT_CHILDREN));
      }
      const closed = await waitForFanoutCard(
        `the fanout card should draw ${DRAWN_CHILDREN} children and a "+${overflow}" overflow button`,
        (card) =>
          card.children === DRAWN_CHILDREN &&
          card.overflow.length === 1 &&
          card.expander === `Hide ${FANOUT_CHILDREN} children`,
      );
      assert.deepStrictEqual(closed.overflow, [
        `Show ${overflow} more children`,
      ]);
      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-overflow",
        expect: `The fanout card with ${FANOUT_CHILDREN} children and maxNeighbours ${DRAWN_CHILDREN}: ${DRAWN_CHILDREN} child cards and a "+${overflow}" button.`,
        measured: { ...closed },
      });

      await clickInWebview(LINEAGE, {
        role: "button",
        name: `Show ${overflow} more children`,
      });
      const open = await waitForFanoutCard(
        `opening the overflow should draw ${2 * DRAWN_CHILDREN} children and a "+${overflow - DRAWN_CHILDREN}" button`,
        (card) =>
          card.children === 2 * DRAWN_CHILDREN && card.overflow.length === 1,
      );
      assert.deepStrictEqual(open.overflow, [
        `Show ${overflow - DRAWN_CHILDREN} more children`,
      ]);
      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-overflow-open",
        expect: `After one overflow press: ${2 * DRAWN_CHILDREN} child cards and a "+${overflow - DRAWN_CHILDREN}" button.`,
        measured: { ...open },
      });

      await clickInWebview(LINEAGE, {
        role: "button",
        name: `Hide ${FANOUT_CHILDREN} children`,
      });
      const collapsed = await waitForFanoutCard(
        "collapsing the children should draw no child cards and no overflow button",
        (card) =>
          card.children === 0 &&
          card.overflow.length === 0 &&
          card.expander === `Show ${FANOUT_CHILDREN} children`,
      );
      await evidence?.capture(LINEAGE, {
        name: "lineage-groups-overflow-closed",
        expect: `After collapsing the children: no child cards, no "+N" button, and the expander reads "Show ${FANOUT_CHILDREN} children".`,
        measured: { ...collapsed },
      });
    } finally {
      await config.update(
        "lineage.groupBy",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
    }
  });
});
