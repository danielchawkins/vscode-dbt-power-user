import * as vscode from "vscode";
import { pollUntil } from "../async";
import { evaluatePanel } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import { EXTENSION_ID, PANELS } from "./panels";
import { waitFor } from "./probeLog";
import { cdpPort, smokeHost } from "./smokeEnv";
import type { PanelEntry } from "./webviewInteractions";
import {
  clickInWebview,
  clickWebviewPoint,
  expectWebviewDom,
  interactionEvidence,
  pressKeyInWebview,
  readDocsState,
  showPanel,
  waitForDocsClean,
} from "./webviewInteractions";

const DOCS: PanelEntry = PANELS.docsEdit;
/**
 * The Save chevron: the popover trigger right after the Save button in SaveDocumentation's DropdownButton. The
 * doc-block inserter renders its own aria-haspopup=dialog trigger when a model has doc blocks, so the selector is
 * scoped to the Save group rather than matching any dialog trigger.
 */
const SAVE_CHEVRON = "button + button[aria-haspopup=dialog]";

const READ_CHEVRON = `(() => {
  if (document.body.dataset.entry !== "documentationEditor") return null;
  const chevron = document.querySelector(${JSON.stringify(SAVE_CHEVRON)});
  return {
    entry: "documentationEditor",
    labelsSave: chevron?.previousElementSibling?.textContent.trim() === "Save",
    expanded: chevron?.getAttribute("aria-expanded") ?? null,
    focused: chevron !== null && document.activeElement === chevron,
  };
})()`;

/** Sets the description the way React sees a keystroke, so the editor becomes dirty. */
const typeDescription = (text: string) => `(() => {
  if (document.body.dataset.entry !== "documentationEditor") return null;
  const input = document.querySelector("textarea");
  if (!input) return null;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(text)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return { entry: "documentationEditor" };
})()`;

/**
 * The summary's source label and its notice, each as the webview renders them; null when not shown. What it reads is
 * scrolled into view, so the screenshot taken next shows it.
 */
const READ_SUMMARY = `(() => {
  if (document.body.dataset.entry !== "documentationEditor") return null;
  const label = Array.from(document.querySelectorAll("p"))
    .find((p) => /^Types (from|inferred)/.test(p.textContent.trim()));
  const alert = document.querySelector('[role="alert"]');
  (label ?? alert)?.scrollIntoView({ block: "start" });
  const sourceLabel = label?.textContent.trim() ?? null;
  const notice = alert?.textContent.trim() ?? null;
  return { entry: "documentationEditor", sourceLabel, notice };
})()`;

const runsHere = () => currentFixtureName() === "single-project";
interface SummaryReading {
  entry: string;
  sourceLabel: string | null;
  notice: string | null;
}

/** Polls the summary until its source label or its notice is shown, then returns both as read. */
async function waitForSummary(): Promise<SummaryReading> {
  const summary = await pollUntil(
    async () => {
      const match = await evaluatePanel<SummaryReading>(
        cdpPort(),
        DOCS.entry,
        READ_SUMMARY,
      );
      return match?.value ?? undefined;
    },
    (last) => Boolean(last?.sourceLabel) || Boolean(last?.notice),
    {
      timeoutMs: 60_000,
      intervalMs: 250,
      describe: "the summary to show a source label or a notice",
    },
  );
  return summary!;
}

const host = smokeHost;

/** Polls the description until `done` holds; the editor loads it asynchronously. */
async function waitForDescription(
  done: (text: string) => boolean,
): Promise<string> {
  const text = await pollUntil(
    async () => (await readDocsState(cdpPort()))?.description ?? null,
    (last) => last !== null && done(last),
    {
      timeoutMs: 10_000,
      intervalMs: 250,
      describe: "the description to match",
    },
  );
  return text!;
}

async function setDescription(text: string): Promise<void> {
  await evaluatePanel(cdpPort(), DOCS.entry, typeDescription(text));
}

interface ChevronState {
  entry: string;
  labelsSave: boolean;
  expanded: string | null;
  focused: boolean;
}

async function readChevron(): Promise<ChevronState> {
  const match = await evaluatePanel<ChevronState>(
    cdpPort(),
    DOCS.entry,
    READ_CHEVRON,
  );
  return (
    match?.value ?? {
      entry: DOCS.entry,
      labelsSave: false,
      expanded: null,
      focused: false,
    }
  );
}

suite("Documentation editor interactions", function () {
  this.timeout(300_000);

  test("clicks the Save button, its chevron and Help, and checks each result", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    await api.ready;
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        "models/child.sql",
      ),
    );
    await showPanel(DOCS);
    const original = await waitForDescription(() => true);
    let bodyPassed = false;
    try {
      const edit = `${original} smoke draft`;
      await setDescription(edit);
      await waitForDescription((text) => text === edit);
      await expectWebviewDom(DOCS, { role: "button", name: "Save" });

      // The menu lists its two save options only when the model has no patch path. The Save button saves
      // straight to the patch path when there is one, so the options are checked before the button is clicked.
      await clickWebviewPoint(DOCS, { selector: SAVE_CHEVRON });
      await expectWebviewDom(DOCS, { role: "dialog" });
      await expectWebviewDom(DOCS, { role: "button", name: "Existing file" });
      await expectWebviewDom(DOCS, { role: "button", name: "New file" });
      const open = await readChevron();
      if (!open.labelsSave || open.expanded !== "true") {
        throw new Error(
          `the chevron is not the Save menu's: ${JSON.stringify(open)}`,
        );
      }
      await evidence?.capture(DOCS, {
        name: "documentation-save-menu-open",
        expect:
          "Save menu open under the chevron beside the Save button, listing the save options.",
        measured: { popover: "save menu" },
      });

      await pressKeyInWebview(DOCS, "Escape");
      await expectWebviewDom(DOCS, { absent: "[role=dialog]" });
      const closed = await readChevron();
      if (closed.expanded !== "false" || !closed.focused) {
        throw new Error(
          `Escape should collapse the chevron and focus it: ${JSON.stringify(closed)}`,
        );
      }
      await evidence?.capture(DOCS, {
        name: "documentation-save-menu-closed-escape",
        expect: "No popover; the Save chevron is collapsed and has focus.",
        measured: {
          closedBy: "Escape",
          expanded: closed.expanded,
          chevronFocused: closed.focused,
        },
      });

      // Save without a patch path only opens the same menu, so this click changes nothing on disk.
      await clickInWebview(DOCS, { role: "button", name: "Save" });
      await expectWebviewDom(DOCS, { role: "dialog" });
      const saveOpen = await readChevron();
      if (saveOpen.expanded !== "true") {
        throw new Error(
          `the Save button should open the menu: ${JSON.stringify(saveOpen)}`,
        );
      }
      await evidence?.capture(DOCS, {
        name: "documentation-save-button-menu-open",
        expect:
          "Save menu open from the Save button, the same menu the chevron opens; the chevron reports expanded.",
        measured: {
          popover: "save menu",
          openedBy: "Save button",
          expanded: saveOpen.expanded,
        },
      });
      await pressKeyInWebview(DOCS, "Escape");
      await expectWebviewDom(DOCS, { absent: "[role=dialog]" });

      await clickInWebview(DOCS, { role: "button", name: "Help" });
      await expectWebviewDom(DOCS, { role: "complementary", name: "Help" });
      await evidence?.capture(DOCS, {
        name: "documentation-help-open",
        expect: "Help drawer open beside the editor, titled Help.",
        measured: { drawer: "Help" },
      });
      await pressKeyInWebview(DOCS, "Escape");
      await expectWebviewDom(DOCS, { absent: "aside[aria-label=Help]" });
      await evidence?.capture(DOCS, {
        name: "documentation-help-closed-escape",
        expect: "No drawer; the Help drawer is closed.",
        measured: { closedBy: "Escape" },
      });
      bodyPassed = true;
    } finally {
      // Restore even when an assertion failed, and wait for the editor to report clean: the description
      // alone can match before the editor has settled, and a dirty editor leaks into the next suite.
      try {
        await setDescription(original);
        await waitForDescription((text) => text === original);
        await waitForDocsClean(cdpPort());
        // A clean page is not enough: the host keeps drafts in memory and sends one with the next render, so a
        // draft it still holds would open the next suite's editor dirty.
        await waitFor(
          "host holds no documentation drafts",
          async () =>
            (await vscode.commands.executeCommand<string[]>(
              "fusionPowerUser.test.heldDocDrafts",
            )) ?? [],
          { until: (held) => held.length === 0, attempts: 40 },
        );
      } catch (restoreError) {
        // A body failure is the one to report, so a restore failure after it is logged, not thrown.
        if (bodyPassed) {
          throw restoreError;
        }
        console.error(
          "restoring the documentation editor failed:",
          restoreError,
        );
      }
    }
  });

  test("records the column types, then pulls the upstream descriptions, and checks each summary", async function () {
    if (!runsHere()) {
      this.skip();
      return;
    }
    const evidence = interactionEvidence(host());

    const api = await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
    await api.ready;
    await vscode.window.showTextDocument(
      vscode.Uri.joinPath(
        vscode.workspace.workspaceFolders![0].uri,
        "models/child.sql",
      ),
    );
    await showPanel(DOCS);
    await waitForDescription(() => true);

    await clickInWebview(DOCS, { role: "button", name: "Record column types" });
    const types = await waitForSummary();
    await evidence?.capture(DOCS, {
      name: "documentation-type-proposals-recorded",
      expect:
        "Summary after Record column types shows the types source label, or the notice when no source answered.",
      measured: { read: types.sourceLabel ?? types.notice },
    });
    // Dismiss clears the type proposals, so the descriptions summary reads on its own.
    await clickInWebview(DOCS, { role: "button", name: "Dismiss" });

    await clickInWebview(DOCS, {
      role: "button",
      name: "Pull upstream descriptions",
    });
    const descriptions = await waitForSummary();
    await evidence?.capture(DOCS, {
      name: "documentation-description-proposals-pulled",
      expect:
        "Summary after Pull upstream descriptions shows its notice; descriptions carry no source label.",
      measured: { read: descriptions.notice ?? descriptions.sourceLabel },
    });
    await clickInWebview(DOCS, { role: "button", name: "Dismiss" });
  });
});
