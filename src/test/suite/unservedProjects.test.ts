import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceFolder } from "vscode";
import {
  commands,
  ConfigurationTarget,
  EventEmitter,
  Uri,
  window,
  workspace,
} from "vscode";
import { UnservedProjectsNotice } from "../../features/projectSetup/unservedProjects";
import type {
  ProjectRegistry,
  UnservedRoot,
} from "../../projects/registry/projectRegistry";

const folder: WorkspaceFolder = {
  uri: Uri.file(path.join("/", "repo", "staging")),
  name: "staging",
  index: 0,
};
const root = Uri.file(
  path.join(folder.uri.fsPath, "transformation", "dbt", "general"),
);

function fakeRegistry() {
  const emitter = new EventEmitter<UnservedRoot>();
  return {
    registry: {
      onDidFindUnservedRoot: emitter.event,
    } as unknown as ProjectRegistry,
    fire: (unserved: UnservedRoot) => emitter.fire(unserved),
  };
}

describe("UnservedProjectsNotice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns once per root and reason, and Enable clears every disabling layer", async () => {
    const update = vi.fn(() => Promise.resolve());
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      inspect: () => ({
        key: "enabled",
        workspaceFolderValue: false,
        workspaceValue: false,
      }),
      update,
    } as any);
    const warn = vi
      .spyOn(window, "showWarningMessage")
      .mockResolvedValue("Enable" as any);
    const { registry, fire } = fakeRegistry();
    const notice = new UnservedProjectsNotice(registry);

    fire({ reason: "disabled", folder, root });
    fire({ reason: "disabled", folder, root });

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      "folder settings (.vscode/settings.json) and workspace settings",
    );
    expect(update).toHaveBeenCalledWith(
      "enabled",
      undefined,
      ConfigurationTarget.WorkspaceFolder,
    );
    expect(update).toHaveBeenCalledWith(
      "enabled",
      undefined,
      ConfigurationTarget.Workspace,
    );
    notice.dispose();
  });

  it("names the entry and the path a missing projects entry resolved to, and opens folder settings", async () => {
    const warn = vi
      .spyOn(window, "showWarningMessage")
      .mockResolvedValue("Open Settings" as any);
    const execute = vi
      .spyOn(commands, "executeCommand")
      .mockResolvedValue(undefined);
    const { registry, fire } = fakeRegistry();
    const notice = new UnservedProjectsNotice(registry);

    fire({
      reason: "missingProjectFile",
      folder,
      entry: "~/.dbt/",
      root: "/home/me/.dbt",
    });

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        "workbench.action.openFolderSettings",
        folder.uri,
      ),
    );
    expect(warn.mock.calls[0][0]).toContain(
      "entry ~/.dbt/ in the staging folder resolves to /home/me/.dbt, which has no dbt_project.yml",
    );
    notice.dispose();
  });

  it("opens trust management for an untrusted workspace", async () => {
    vi.spyOn(window, "showWarningMessage").mockResolvedValue(
      "Manage Trust" as any,
    );
    const execute = vi
      .spyOn(commands, "executeCommand")
      .mockResolvedValue(undefined);
    const { registry, fire } = fakeRegistry();
    const notice = new UnservedProjectsNotice(registry);

    fire({ reason: "untrusted", folder, root });

    await vi.waitFor(() =>
      expect(execute).toHaveBeenCalledWith("workbench.trust.manage"),
    );
    notice.dispose();
  });
});
