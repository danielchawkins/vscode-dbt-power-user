import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FusionClientStateReport } from "../../projects/clients/fusionClientDiagnostics";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { PollTimeoutError, pollUntil, sleep } from "../async";
import { checkFusionVersion } from "../integration/helpers/testFixtures";
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

const GENERAL = "worktree_general";
const STAGING_MODEL = "transformation/dbt/general/models/general_model.sql";
const PROBE_MODEL = "tests/fixtures/probe/models/probe_model.sql";
const PACKAGE_MACRO =
  "transformation/dbt/local_packages/temporal/macros/temporal.sql";
const WAIT_TIMEOUT_MS = 45_000;
const POLL_MS = 250;

/**
 * A repository opened as several worktree folders plus the repository root, like a jj or git worktree checkout.
 * `main` declares its project with `${workspaceFolder}` and points profilesDir at it; `staging` sets
 * `fusionPowerUser.enabled: false` in its own settings, which also applies in this multi-root window.
 */
suite("Worktrees smoke", function () {
  this.timeout(240_000);

  suiteSetup(async function () {
    if (currentFixtureName() !== "worktrees") {
      this.skip();
      return;
    }
    assert.ok(process.env.FPU_CDP_PORT, "smoke requires CDP port");
    host();
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    await (
      await ext.activate()
    ).ready;
    const version = checkFusionVersion();
    if (version.kind !== "ok" && version.kind !== "untestedMajor") {
      if (process.env.FPU_SMOKE_REQUIRE_FUSION === "1") {
        throw new Error(
          `FPU_SMOKE_REQUIRE_FUSION=1 but no Fusion binary resolved: ${JSON.stringify(version)}`,
        );
      }
      this.skip();
    }
  });

  test("a ${workspaceFolder} projects entry starts its project", async function () {
    const report = await waitForState(GENERAL, "running");
    assert.strictEqual(report.origin, "explicit");
    assert.strictEqual(
      report.projectRoot,
      path.join(folder("main").uri.fsPath, "transformation", "dbt", "general"),
    );
    assert.strictEqual(
      report.staticAnalysis,
      "baseline",
      "the folder's staticAnalysis applies to the configured project",
    );
  });

  test("a model in a disabled folder says the folder is disabled, and Enable starts it", async function () {
    await open(folder("staging"), STAGING_MODEL);
    const warning = await waitForNotification(
      /fusionPowerUser\.enabled is false for the staging folder/,
    );
    assert.match(warning, /folder settings \(\.vscode\/settings\.json\)/);
    await record(
      "disabled folder explains itself",
      "A warning names the staging folder's enabled: false and offers Enable.",
      { warning },
    );

    await vscode.workspace
      .getConfiguration("fusionPowerUser", folder("staging").uri)
      .update("enabled", undefined, vscode.ConfigurationTarget.WorkspaceFolder);
    const states = await waitFor(async () => {
      const all = await clientStates();
      const staging = all.filter(
        (r) =>
          r.projectName === GENERAL &&
          r.projectRoot.startsWith(folder("staging").uri.fsPath),
      );
      return staging.some((r) => r.state === "running") ? all : undefined;
    }, "staging's project to run once the folder is enabled");
    assert.ok(states.length >= 2);
  });

  test("a macro in a local package without a profile declares no project", async function () {
    await open(folder("main"), PACKAGE_MACRO);
    await sleep(3000);
    const states = await clientStates();
    assert.ok(
      !states.some((r) => r.projectName === "worktree_temporal"),
      `the package should not be a Declared Project: ${JSON.stringify(states.map((r) => r.projectName))}`,
    );
    const texts = await readWorkbenchNotificationTexts(cdpPort(), host());
    assert.ok(
      !texts.some((text) => text.includes("No profile specified")),
      `no profile error should be shown: ${JSON.stringify(texts)}`,
    );
  });

  test("a nested project opened in an editor uses its own profiles.yml, not the folder's profilesDir", async function () {
    await vscode.commands.executeCommand("notifications.clearAll");
    await open(folder("main"), PROBE_MODEL);
    const probeRoot = path.join(
      folder("main").uri.fsPath,
      "tests",
      "fixtures",
      "probe",
    );
    const report = await waitFor(
      async () =>
        (await clientStates()).find(
          (r) => r.projectRoot === probeRoot && r.state === "running",
        ),
      "the probe project to run",
    );
    assert.strictEqual(report.origin, "openedFile");
    assert.strictEqual(
      report.staticAnalysis,
      "strict",
      "the probe project's perProject entry overrides the folder's staticAnalysis",
    );
    await sleep(3000);
    const texts = await readWorkbenchNotificationTexts(cdpPort(), host());
    assert.ok(
      !texts.some((text) => text.includes("worktree_probe")),
      `the probe project should load without a profile error: ${JSON.stringify(texts)}`,
    );
    const states = await clientStates();
    const probe = states.find((r) => r.projectRoot === probeRoot);
    assert.ok(
      !probe?.statusDetail?.includes("not found"),
      `the probe project's status should carry no error: ${probe?.statusDetail}`,
    );
  });
});

function folder(name: string): vscode.WorkspaceFolder {
  const found = vscode.workspace.workspaceFolders?.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(found, `workspace folder ${name} should be open`);
  return found;
}

async function open(
  base: vscode.WorkspaceFolder,
  relative: string,
): Promise<void> {
  await vscode.window.showTextDocument(
    await vscode.workspace.openTextDocument(
      vscode.Uri.joinPath(base.uri, relative),
    ),
  );
}

async function clientStates(): Promise<FusionClientStateReport[]> {
  return (
    (await vscode.commands.executeCommand<FusionClientStateReport[]>(
      FUSION_CLIENT_STATES_COMMAND,
    )) ?? []
  );
}

async function waitForState(
  name: string,
  state: string,
): Promise<FusionClientStateReport> {
  return waitFor(
    async () =>
      (await clientStates()).find(
        (r) => r.projectName === name && r.state === state,
      ),
    `${name} to be ${state}`,
  );
}

async function waitForNotification(pattern: RegExp): Promise<string> {
  await vscode.commands.executeCommand("notifications.showList");
  let seen: string[] = [];
  try {
    return await waitFor(async () => {
      seen = await readWorkbenchNotificationTexts(cdpPort(), host());
      return seen.find((text) => pattern.test(text));
    }, `a notification matching ${pattern}`);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; notifications: ${JSON.stringify(seen)}`,
    );
  } finally {
    await vscode.commands.executeCommand("notifications.hideList");
  }
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  what: string,
): Promise<T> {
  try {
    return (await pollUntil(probe, (value) => value !== undefined, {
      timeoutMs: WAIT_TIMEOUT_MS,
      intervalMs: POLL_MS,
      describe: what,
    }))!;
  } catch (error) {
    if (!(error instanceof PollTimeoutError)) {
      throw error;
    }
    throw new Error(
      `Timed out waiting for ${what}: ${JSON.stringify(await clientStates())}`,
    );
  }
}

const cdpPort = () => process.env.FPU_CDP_PORT ?? "";
const host = () =>
  validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");

async function record(
  name: string,
  expect: string,
  measured: Record<string, unknown>,
): Promise<void> {
  const dir = screenshotDirectory();
  if (!dir) {
    return;
  }
  const fixtureDir = path.join(dir, host(), "worktrees");
  // The checkpoint is about a notification, so the capture shows the notification list.
  await vscode.commands.executeCommand("notifications.showList");
  await sleep(500);
  let png: Buffer;
  try {
    png = await captureWorkbenchScreenshot(cdpPort(), host());
  } finally {
    await vscode.commands.executeCommand("notifications.hideList");
  }
  const file = writeCheckpoint(
    fixtureDir,
    checkpointCount(fixtureDir) + 1,
    { name, expect, measured },
    png,
    {
      host: host(),
      fixture: currentFixtureName(),
      activeEditor: vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
      capturedAt: new Date().toISOString(),
    },
  );
  console.log(`FPU_SMOKE_SCREENSHOT=${file}`);
}
