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

/** The labels the Edge groups section of the Scope popover can list, as the webview labels them. */
const EDGE_GROUP_TEXTS = [
  "Model dependencies",
  "Source dependencies",
  "Grouped dependencies",
  "Column edges",
  "Relationships",
];

/** The Edge groups checkboxes of the Scope popover: each listed group's label and whether it is on. */
const READ_EDGE_GROUPS = `(() => {
  if (document.body.dataset.entry !== "lineage") return null;
  const section = document.querySelector("section[aria-label=Scope]");
  if (!section) return null;
  const texts = ${JSON.stringify(EDGE_GROUP_TEXTS)};
  return {
    entry: "lineage",
    heading: [...section.querySelectorAll("span")].some((span) => span.textContent.trim() === "Edge groups"),
    groups: [...section.querySelectorAll("label")]
      .filter((label) => texts.includes(label.textContent.trim()))
      .map((label) => ({
        text: label.textContent.trim(),
        on: label.querySelector("input[type=checkbox]")?.checked === true,
      })),
  };
})()`;

export interface EdgeGroupsState {
  entry: string;
  heading: boolean;
  groups: { text: string; on: boolean }[];
}

/**
 * Reads the Edge groups section of the Scope popover and asserts it has its heading, and that every listed group is one
 * of the webview's edge groups with an on/off checkbox. A graph with no edge lists none, so the list may be empty.
 */
export async function expectEdgeGroups(): Promise<EdgeGroupsState> {
  const edgeGroups = (
    await evaluatePanel<EdgeGroupsState>(
      cdpPort(),
      LINEAGE.entry,
      READ_EDGE_GROUPS,
    )
  )?.value;
  assert.ok(
    edgeGroups?.heading,
    `the Scope popover shows no Edge groups section: ${JSON.stringify(edgeGroups)}`,
  );
  for (const group of edgeGroups.groups) {
    assert.ok(
      EDGE_GROUP_TEXTS.includes(group.text),
      `an edge group the webview does not define: ${JSON.stringify(group)}`,
    );
  }
  return edgeGroups;
}
