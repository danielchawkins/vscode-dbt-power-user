import * as path from "node:path";
import type { Disposable } from "vscode";
import { commands, window } from "vscode";
import type {
  ProjectRegistry,
  UnservedRoot,
} from "../../projects/registry/projectRegistry";
import { clearDisabled, disablingLayers } from "../../settings";

const ENABLE = "Enable";
const MANAGE_TRUST = "Manage Trust";
const OPEN_SETTINGS = "Open Settings";

const LAYER_NAMES = {
  folder: "folder settings (.vscode/settings.json)",
  workspace: "workspace settings",
  user: "user settings",
} as const;

/** What to tell the user about one unserved root, and the one action that fixes it. */
function describeUnserved(
  unserved: UnservedRoot,
  layers: readonly (keyof typeof LAYER_NAMES)[] = [],
): { message: string; action: string } {
  const folder = unserved.folder.name;
  switch (unserved.reason) {
    case "disabled": {
      const where =
        layers.map((layer) => LAYER_NAMES[layer]).join(" and ") || "settings";
      return {
        message:
          `Found a dbt project at ${unserved.root.fsPath}, but fusionPowerUser.enabled is false for the ` +
          `${folder} folder in ${where}.`,
        action: ENABLE,
      };
    }
    case "untrusted":
      return {
        message: `Found a dbt project at ${unserved.root.fsPath}. Trust this workspace to start Fusion for it.`,
        action: MANAGE_TRUST,
      };
    case "missingProjectFile":
      return {
        message:
          `fusionPowerUser.projects entry ${unserved.entry} in the ${folder} folder resolves to ` +
          `${unserved.root}, which has no dbt_project.yml. No project in that folder is served until it is fixed.`,
        action: OPEN_SETTINGS,
      };
    case "invalidEntry":
      return {
        message:
          `fusionPowerUser.projects in the ${folder} folder has an invalid entry ${JSON.stringify(unserved.entry)}. ` +
          "No project in that folder is served until it is fixed.",
        action: OPEN_SETTINGS,
      };
  }
}

function key(unserved: UnservedRoot): string {
  const target =
    "root" in unserved
      ? typeof unserved.root === "string"
        ? unserved.root
        : unserved.root.fsPath
      : unserved.entry;
  return `${unserved.reason}\0${unserved.folder.uri.fsPath}\0${path.normalize(target)}`;
}

/** Tells the user, once per root and reason per window, why a project it found is not served, and offers the fix. */
export class UnservedProjectsNotice implements Disposable {
  private readonly shown = new Set<string>();
  private readonly subscription: Disposable;

  constructor(registry: ProjectRegistry) {
    this.subscription = registry.onDidFindUnservedRoot((unserved) =>
      this.notify(unserved),
    );
  }

  private notify(unserved: UnservedRoot): void {
    const id = key(unserved);
    if (this.shown.has(id)) {
      return;
    }
    this.shown.add(id);
    const layers =
      unserved.reason === "disabled" ? disablingLayers(unserved.folder) : [];
    const { message, action } = describeUnserved(unserved, layers);
    void Promise.resolve(window.showWarningMessage(message, action)).then(
      async (picked) => {
        if (picked === ENABLE) {
          await clearDisabled(unserved.folder);
        } else if (picked === MANAGE_TRUST) {
          await commands.executeCommand("workbench.trust.manage");
        } else if (picked === OPEN_SETTINGS) {
          await commands.executeCommand(
            "workbench.action.openFolderSettings",
            unserved.folder.uri,
          );
        }
      },
    );
  }

  dispose(): void {
    this.subscription.dispose();
  }
}
