import { window } from "vscode";
import { parseDocument } from "yaml";

interface YamlModel {
  key?: { value: string };
  value?: { items?: Array<YamlModelItem> };
}

interface YamlModelItem {
  items?: Array<{
    key?: { value: string };
    value?: { toString(): string };
  }>;
  range?: [number, number];
}

export function getCurrentlySelectedModelNameInYamlConfig(): string {
  if (
    window.activeTextEditor === undefined ||
    window.activeTextEditor.document.languageId !== "yaml"
  ) {
    return "";
  }

  try {
    const parsedYaml = parseDocument(
      window.activeTextEditor.document.getText(),
    );
    if (parsedYaml.contents === null) {
      return "";
    }
    const cursorPosition = window.activeTextEditor.selection.active;
    const offset = window.activeTextEditor.document.offsetAt(cursorPosition);

    const contents = parsedYaml.contents as { items?: Array<YamlModel> };
    if (!contents.items) {
      return "";
    }

    const modelsNode = contents.items.find(
      (item) => item?.key?.value === "models",
    );
    if (!modelsNode?.value?.items) {
      return "";
    }

    // Find a model at the current position
    for (const model of modelsNode.value.items) {
      if (!model?.items) {
        continue;
      }

      const nameNode = model.items.find((item) => item?.key?.value === "name");
      if (!nameNode?.value) {
        continue;
      }

      if (model.range && model.range[0] < offset && offset < model.range[1]) {
        return nameNode.value.toString();
      }
    }
  } catch {
    // A YAML document mid-edit does not parse; no model is selected.
  }
  return "";
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
