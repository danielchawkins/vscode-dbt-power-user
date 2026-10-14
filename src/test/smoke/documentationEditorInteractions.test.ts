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
  pressKeyInWebview,
  readDocsState,
  showPanel,
  waitForDocsClean,
} from "./webviewInteractions";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const DOCS: PanelEntry = {
  container: "workbench.view.extension.docs_edit_view",
  command: "fusionPowerUser.DocsEdit.focus",
  entry: "documentationEditor",
};
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

const runsHere = () => currentFixtureName() === "single-project";
const host = () =>
  validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls the description until `done` holds; the editor loads it asynchronously. */
async function waitForDescription(
  done: (text: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  let last: string | null = null;
  do {
    const docs = await readDocsState(process.env.FPU_CDP_PORT!);
    last = docs?.description ?? null;
    if (last !== null && done(last)) {
      return last;
    }
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error(`the description never matched; last value: ${last}`);
}

async function setDescription(text: string): Promise<void> {
  await evaluatePanel(
    process.env.FPU_CDP_PORT!,
    DOCS.entry,
    typeDescription(text),
  );
}

interface ChevronState {
  entry: string;
  labelsSave: boolean;
  expanded: string | null;
  focused: boolean;
}

async function readChevron(): Promise<ChevronState> {
  const match = await evaluatePanel<ChevronState>(
    process.env.FPU_CDP_PORT!,
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
        await waitForDocsClean(process.env.FPU_CDP_PORT!);
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
});
