import * as assert from "node:assert";
import { evaluatePanel } from "./panelFrames";
import { PANELS } from "./panels";
import { cdpPort } from "./smokeEnv";
import type { PanelEntry } from "./webviewInteractions";

const LINEAGE: PanelEntry = PANELS.lineage;

/** The Exclusions section in the Scope popover: each rule's text, its Remove button, and whether the input and Add rule are there. */
const READ_EXCLUSIONS = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const section = document.querySelector("section[aria-label=Exclusions]");
  if (!section) return null;
  return {
    entry: "lineage",
    rules: [...section.querySelectorAll("li")].map((item) => ({
      text: item.textContent.trim(),
      remove: item.querySelector("button")?.getAttribute("aria-label") ?? null,
    })),
    input: section.querySelector("input[aria-label='Exclusion rule']") !== null,
    addButton: [...section.querySelectorAll("button")].some(
      (button) => button.textContent.trim() === "Add rule",
    ),
  };
})()`;

interface ExclusionsState {
  entry: string;
  rules: { text: string; remove: string | null }[];
  input: boolean;
  addButton: boolean;
}

async function readExclusions(): Promise<ExclusionsState | undefined> {
  return (
    await evaluatePanel<ExclusionsState>(
      cdpPort(),
      LINEAGE.entry,
      READ_EXCLUSIONS,
    )
  )?.value;
}

/** Reads the Exclusions section and asserts it lists each rule with its count or failure, and a Remove button. */
export async function expectExclusions(): Promise<ExclusionsState> {
  const exclusions = await readExclusions();
  assert.ok(
    exclusions &&
      exclusions.input &&
      exclusions.addButton &&
      exclusions.rules.length > 0,
    `the Scope popover shows no Exclusions section: ${JSON.stringify(exclusions)}`,
  );
  for (const rule of exclusions.rules) {
    assert.ok(
      /\d+ nodes? excluded|Not resolved: /.test(rule.text) &&
        rule.remove?.startsWith("Remove "),
      `an exclusion rule lacks its count or failure, or its Remove button: ${JSON.stringify(rule)}`,
    );
  }
  return exclusions;
}
