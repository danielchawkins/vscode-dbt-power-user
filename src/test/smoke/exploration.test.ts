import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FusionClientStateReport } from "../../projects/clients/fusionClientDiagnostics";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import {
  captureWorkbenchScreenshot,
  readWorkbenchNotificationTexts,
  validateSmokeHost,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import { EXTENSION_ID } from "./panels";
import {
  checkpointCount,
  screenshotDirectory,
  writeCheckpoint,
} from "./visualEvidence";

const SETTLE_MS = 20_000;

/**
 * Exploration, not an assertion suite: opens a copy of a real repository the way a user and an agent would, and
 * records which projects start and which notifications appear after each step. Runs only when
 * `FPU_SMOKE_EXPLORE_STEPS` names a JSON file of steps, each `{ name, open, editor }` with `open` relative to the
 * first workspace folder; `editor: false` opens the document without showing it, as an agent's edit does.
 */
suite("Exploration", function () {
  this.timeout(30 * 60_000);

  test("records what each step starts and shows", async function () {
    const stepsFile = process.env.FPU_SMOKE_EXPLORE_STEPS;
    if (!stepsFile) {
      this.skip();
      return;
    }
    const steps = JSON.parse(fs.readFileSync(stepsFile, "utf8")) as {
      name: string;
      open: string;
      editor: boolean;
    }[];
    const port = process.env.FPU_CDP_PORT ?? "";
    const host = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    await (
      await ext?.activate()
    )?.ready;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      throw new Error("exploration needs a workspace folder");
    }

    await record(port, host, "after activation");
    for (const step of steps) {
      await vscode.commands.executeCommand("notifications.clearAll");
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(folder.uri, step.open),
      );
      if (step.editor) {
        await vscode.window.showTextDocument(document);
      }
      await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
      await record(port, host, step.name);
    }
  });
});

async function record(port: string, host: string, name: string) {
  const states =
    (await vscode.commands.executeCommand<FusionClientStateReport[]>(
      FUSION_CLIENT_STATES_COMMAND,
    )) ?? [];
  await vscode.commands.executeCommand("notifications.showList");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const notifications = await readWorkbenchNotificationTexts(port, host);
  const measured = {
    projects: states.map((s) => ({
      name: s.projectName,
      root: s.projectRoot,
      origin: s.origin,
      state: s.state,
      detail: s.statusDetail,
    })),
    notifications,
  };
  console.log(`FPU_EXPLORE ${name} ${JSON.stringify(measured)}`);
  const dir = screenshotDirectory();
  if (dir) {
    const fixtureDir = path.join(dir, host, currentFixtureName() ?? "explore");
    const png = await captureWorkbenchScreenshot(port, host);
    writeCheckpoint(
      fixtureDir,
      checkpointCount(fixtureDir) + 1,
      { name, expect: "exploration", measured },
      png,
      {
        host,
        activeEditor:
          vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
      },
    );
  }
  await vscode.commands.executeCommand("notifications.hideList");
}
