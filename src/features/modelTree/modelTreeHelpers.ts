import { window } from "vscode";
import { modelAt } from "../../core/yaml/schemaYaml";

export function getCurrentlySelectedModelNameInYamlConfig(): string {
  const editor = window.activeTextEditor;
  if (editor?.document.languageId !== "yaml") {
    return "";
  }
  const offset = editor.document.offsetAt(editor.selection.active);
  return modelAt(editor.document.getText(), offset)?.name ?? "";
}

const MEDIUM_DEPTH_THRESHOLD = 5;
const HIGH_DEPTH_THRESHOLD = 10;
const LOW_DEPTH_COLOR = "#00ff00";
const MEDIUM_DEPTH_COLOR = "#ffa500";
const HIGH_DEPTH_COLOR = "#ff0000";

export function getDepthColor(depth: number): string {
  if (depth >= HIGH_DEPTH_THRESHOLD) {
    return HIGH_DEPTH_COLOR;
  }
  if (depth >= MEDIUM_DEPTH_THRESHOLD) {
    return MEDIUM_DEPTH_COLOR;
  }
  return LOW_DEPTH_COLOR;
}
