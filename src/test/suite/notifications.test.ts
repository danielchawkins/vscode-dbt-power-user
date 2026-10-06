import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { commands, Uri, window } from "vscode";
import {
  bindExtensionOutput,
  notifyError,
  notifyErrorWithoutProject,
} from "../../projects/notifications";

const SHOW_OUTPUT = "Show output";

describe("error notifications", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names a Declared Project and opens its output on request", async () => {
    const root = Uri.file("/p");
    (window.showErrorMessage as Mock).mockResolvedValueOnce(SHOW_OUTPUT);
    await notifyError({ root, name: "jaffle" }, "Could not save", "disk full");
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "jaffle: Could not save: disk full",
      SHOW_OUTPUT,
    );
    expect(commands.executeCommand).toHaveBeenCalledWith(
      "fusionPowerUser.showFusionOutput",
      root,
    );
  });

  it("names a loaded Project and leaves the output closed when dismissed", async () => {
    const projectRoot = Uri.file("/p");
    (window.showErrorMessage as Mock).mockResolvedValueOnce(undefined);
    await notifyError(
      { projectRoot, getProjectName: () => "jaffle" },
      "Could not compile",
      new Error("bad ref"),
    );
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "jaffle: Could not compile: bad ref",
      SHOW_OUTPUT,
    );
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it("opens the extension log when there is no project", async () => {
    const show = vi.fn();
    bindExtensionOutput(show);
    (window.showErrorMessage as Mock).mockResolvedValueOnce(SHOW_OUTPUT);
    await notifyError(undefined, "No active editor found");
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "No active editor found",
      SHOW_OUTPUT,
    );
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("appends a non-Error cause as text", async () => {
    (window.showErrorMessage as Mock).mockResolvedValueOnce(undefined);
    await notifyErrorWithoutProject("Failed", 42);
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      "Failed: 42",
      SHOW_OUTPUT,
    );
  });
});
