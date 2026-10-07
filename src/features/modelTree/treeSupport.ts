import * as path from "path";
import { Disposable, TextDocument, window } from "vscode";
import { NodeMetaData, NodeMetaMap } from "../../core/manifest/types";
import { extensionRoot } from "../../extensionRoot";
import { Projects } from "../../projects/projects";
import { getCurrentlySelectedModelNameInYamlConfig } from "./modelTreeHelpers";

export interface IconPath {
  light: string;
  dark: string;
}

export abstract class Node {
  label: string;
  key: string;
  url: string | undefined;
  iconPath: IconPath = {
    light: path.join(extensionRoot, "../media/images/model_light.svg"),
    dark: path.join(extensionRoot, "../media/images/model_dark.svg"),
  };
  displayInModelTree: boolean = true;

  constructor(label: string, key: string, url?: string) {
    this.label = label;
    this.key = key;
    this.url = url;
  }
}

/** Subscriptions that refresh a tree when the active editor, its selection, a manifest or the project set changes. */
export function refreshOnProjectChange(
  projects: Projects,
  refresh: () => void,
): Disposable[] {
  return [
    window.onDidChangeActiveTextEditor(() => refresh()),
    projects.onDidChangeManifest(() => refresh()),
    projects.onDidRemoveProject(() => refresh()),
    window.onDidChangeTextEditorSelection(() => refresh()),
  ];
}

// Find appropriate a model from file content (if YAML) or from a file name (otherwise)
export function lookupModelByEditorContent(
  nodeMetaMap: NodeMetaMap,
  document: TextDocument,
): NodeMetaData | undefined {
  const modelCandidateName =
    document.languageId === "yaml" &&
    getCurrentlySelectedModelNameInYamlConfig()
      ? getCurrentlySelectedModelNameInYamlConfig()
      : path.parse(document.fileName).name;
  return nodeMetaMap.lookupByBaseName(modelCandidateName);
}
