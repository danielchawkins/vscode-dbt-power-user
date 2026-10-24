import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkspaceFolder } from "vscode";
import { Uri } from "vscode";
import { CloseAction, ErrorAction } from "vscode-languageclient/node";
import { clientErrorHandler } from "../../fusion/clientLifecycle";
import { createMockLogOutputChannel } from "../mock/vscode";
import { declaredProject } from "../projectHarness";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace/general"),
  name: "general",
  index: 0,
};

const writeError = new Error("Cannot call write after a stream was destroyed");

describe("clientErrorHandler", () => {
  let tmp: string;
  let root: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "fpu-client-lifecycle-"));
    root = path.join(tmp, "finance_general");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function setup(input: { isInactive: boolean; rootExists: boolean }) {
    if (input.rootExists) {
      mkdirSync(root, { recursive: true });
      writeFileSync(path.join(root, "dbt_project.yml"), "name: finance\n");
    }
    const outputChannel = createMockLogOutputChannel("finance_general");
    const handler = clientErrorHandler({
      project: declaredProject("finance_general", root, folder),
      outputChannel,
      isInactive: () => input.isInactive,
    });
    return { handler, outputChannel };
  }

  it("raises no notification for a write error after the client stopped", () => {
    const { handler, outputChannel } = setup({
      isInactive: true,
      rootExists: true,
    });

    const result = handler.error(writeError, undefined, 1);

    expect(result).toEqual({
      action: ErrorAction.Shutdown,
      handled: true,
      message: expect.stringContaining(writeError.message),
    });
    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.error).not.toHaveBeenCalled();
    expect(outputChannel.warn).not.toHaveBeenCalled();
  });

  it("raises no notification when the project root is gone", () => {
    const { handler, outputChannel } = setup({
      isInactive: false,
      rootExists: false,
    });

    const result = handler.error(writeError, undefined, 1);

    expect(result).toEqual({
      action: ErrorAction.Shutdown,
      handled: true,
      message: expect.stringContaining(root),
    });
    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.error).not.toHaveBeenCalled();
    expect(outputChannel.warn).not.toHaveBeenCalled();
  });

  it("notifies a connection error on a running client, and the message names the root", () => {
    const { handler, outputChannel } = setup({
      isInactive: false,
      rootExists: true,
    });

    const result = handler.error(writeError, undefined, 1);

    expect(result).toEqual({
      action: ErrorAction.Continue,
      message: `Fusion client finance_general (${root}): connection to server is erroring: ${writeError.message}`,
    });
    expect(outputChannel.debug).not.toHaveBeenCalled();
  });

  it("shuts a running client down after the third error", () => {
    const { handler } = setup({ isInactive: false, rootExists: true });

    expect(handler.error(writeError, undefined, 4)).toMatchObject({
      action: ErrorAction.Shutdown,
    });
  });

  it("silences a close after the client stopped, with one debug line", () => {
    const { handler, outputChannel } = setup({
      isInactive: true,
      rootExists: true,
    });

    expect(handler.closed()).toMatchObject({
      action: CloseAction.DoNotRestart,
      handled: true,
    });
    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.error).not.toHaveBeenCalled();
  });

  it("notifies a close on a running client, and the message names the root", () => {
    const { handler } = setup({ isInactive: false, rootExists: true });

    expect(handler.closed()).toEqual({
      action: CloseAction.DoNotRestart,
      message: `Fusion client finance_general (${root}): the server closed the connection and will not be restarted.`,
    });
  });
});
