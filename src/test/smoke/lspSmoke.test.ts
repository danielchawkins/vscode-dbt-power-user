import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FusionClientStateReport } from "../../projects/clients/fusionClientDiagnostics";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { pollUntil } from "../async";
import { checkFusionVersion } from "../integration/helpers/testFixtures";
import {
  assertNoWorkbenchNotifications,
  validateSmokeHost,
  waitForWorkbenchNotificationsToSettle,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import { EXTENSION_ID } from "./panels";

const EXPECTED_PROJECT_NAMES = ["general", "sox"];
const LSP_WAIT_TIMEOUT_MS = 45_000;
const LSP_WAIT_POLL_MS = 100;

suite("Multi-root LSP smoke", function () {
  // Bounded waits: Fusion client states 45s, then each project's manifest wait 45s (run in parallel), then
  // notifications 30s. The limit covers their sum plus about 30s of headroom.
  this.timeout(150_000);

  test("completes the Fusion LSP initialize handshake for every Declared Project", async function () {
    if (currentFixtureName() !== "multi-root") {
      this.skip();
      return;
    }

    const cdpPort = process.env.FPU_CDP_PORT;
    assert.ok(cdpPort, "smoke requires CDP port");
    const smokeHost = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    await (
      await ext.activate()
    ).ready;
    assert.ok(ext.isActive, "packaged extension should activate");

    // Checked before the notification assertion: a genuinely missing Fusion binary makes
    // the extension itself show a startup notification, which would otherwise fail this
    // suite on the wrong assertion instead of on the missing-Fusion condition itself.
    const fusionVersion = checkFusionVersion();
    const fusionAvailable =
      fusionVersion.kind === "ok" || fusionVersion.kind === "untestedMajor";
    if (!fusionAvailable) {
      console.log(
        `FPU_SMOKE_LSP=${JSON.stringify({ skipped: "no Fusion", verdict: fusionVersion })}`,
      );
      if (process.env.FPU_SMOKE_REQUIRE_FUSION === "1") {
        throw new Error(
          `FPU_SMOKE_REQUIRE_FUSION=1 but no Fusion binary resolved: ${JSON.stringify(fusionVersion)}`,
        );
      }
      this.skip();
      return;
    }

    await assertNoWorkbenchNotifications(cdpPort, smokeHost);

    const states = await waitForFusionClientStates();
    console.log(`FPU_SMOKE_LSP=${JSON.stringify(states)}`);

    assert.deepStrictEqual(
      states.map((state) => state.projectName).sort(),
      EXPECTED_PROJECT_NAMES.toSorted(),
      "expected one Fusion LSP client per Declared Project",
    );
    for (const state of states) {
      assert.strictEqual(
        state.state,
        "running",
        `${state.projectName} Fusion LSP initialize handshake should complete: ${state.failureReason ?? ""}`,
      );
    }

    await assertEachProjectUsedItsOwnProfilesDir();
    await waitForWorkbenchNotificationsToSettle(cdpPort, smokeHost);
    await assertNoWorkbenchNotifications(cdpPort, smokeHost);
  });
});

/**
 * Opened as a workspace, each project folder's `fusionPowerUser.profilesDir` names a different directory
 * and the environment names neither. A manifest for each project proves every folder's own setting reached
 * the dbt command run for that project.
 */
async function assertEachProjectUsedItsOwnProfilesDir(): Promise<void> {
  assert.ok(
    vscode.workspace.workspaceFile,
    "multi-root must be opened as a workspace so each folder's settings apply",
  );
  await Promise.all(
    EXPECTED_PROJECT_NAMES.map((name) =>
      assertProjectUsedItsOwnProfilesDir(name),
    ),
  );
}

async function assertProjectUsedItsOwnProfilesDir(name: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.find(
    (candidate) => candidate.name === name,
  );
  assert.ok(folder, `workspace must contain the ${name} folder`);
  const configured = vscode.workspace
    .getConfiguration("fusionPowerUser", folder.uri)
    .get<string>("profilesDir");
  assert.ok(configured, `${name} must set fusionPowerUser.profilesDir`);
  const profilesDir = configured.replace(
    "${workspaceFolder}",
    folder.uri.fsPath,
  );

  const root = folder.uri.fsPath;
  const manifestPath = path.join(root, "target", "manifest.json");
  const dbtLog = path.join(root, "logs", "dbt.log");
  await pollUntil(
    () => fs.existsSync(manifestPath),
    (exists) => exists,
    {
      timeoutMs: LSP_WAIT_TIMEOUT_MS,
      intervalMs: 250,
      describe: () => {
        const log = fs.existsSync(dbtLog)
          ? fs.readFileSync(dbtLog, "utf-8")
          : "";
        return (
          `${name} parse must write target/manifest.json using its own profilesDir (${profilesDir}); ` +
          `dbt.log tail: ${log.slice(-800)}`
        );
      },
    },
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as {
    nodes: Record<string, unknown>;
  };
  assert.ok(
    `model.${name}.${name}_model` in manifest.nodes,
    `${name} manifest must contain its own model`,
  );
}

async function waitForFusionClientStates(): Promise<FusionClientStateReport[]> {
  return pollUntil(
    () =>
      vscode.commands.executeCommand<FusionClientStateReport[]>(
        FUSION_CLIENT_STATES_COMMAND,
      ),
    (last) =>
      last.length === EXPECTED_PROJECT_NAMES.length &&
      last.every(
        (state) => state.state === "running" || state.state === "failed",
      ),
    {
      timeoutMs: LSP_WAIT_TIMEOUT_MS,
      intervalMs: LSP_WAIT_POLL_MS,
      describe: (last) =>
        `the Fusion LSP initialize handshake: ${JSON.stringify(last)}`,
    },
  );
}
