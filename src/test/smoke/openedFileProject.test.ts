import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FusionClientStateReport } from "../../projects/clients/fusionClientDiagnostics";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { pollUntil } from "../async";
import { checkFusionVersion } from "../integration/helpers/testFixtures";
import {
  assertNoWorkbenchNotifications,
  captureWorkbenchScreenshot,
  evaluateWorkbench,
  revealWorkbench,
  validateSmokeHost,
  waitForWorkbenchNotificationsToSettle,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import { EXTENSION_ID } from "./panels";
import {
  checkpointCount,
  screenshotDirectory,
  writeCheckpoint,
} from "./visualEvidence";

/** The project's dbt name; the folder is `projects/analytics`. */
const PROJECT_NAME = "nested_analytics";
const OPENED_MODEL = "projects/analytics/models/nested_model.sql";
const DECLARED_TEXT = "Declared by an opened file";
const WAIT_TIMEOUT_MS = 45_000;
const POLL_MS = 250;

const LANGUAGE_STATUS_HOVER = `(() => {
  const hover = document.querySelector(".workbench-hover, .monaco-hover:not(.hidden)");
  if (!hover || !hover.innerText.trim()) {
    const entry = document.getElementById("status.languageStatus");
    (entry?.querySelector("a") ?? entry)?.click();
    return null;
  }
  return hover.innerText.trim();
})()`;

suite("Opened-file smoke", function () {
  // Bounded waits: project 45s, notifications 30s, reveal 30s, hover 45s. Mocha must not fire before the
  // notification assertion's report, so the limit covers their sum plus about 30s of headroom.
  this.timeout(180_000);

  test("declares the nested project of an opened file and starts its client", async function () {
    if (currentFixtureName() !== "nested-project") {
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

    const fusionVersion = checkFusionVersion();
    const fusionAvailable =
      fusionVersion.kind === "ok" || fusionVersion.kind === "untestedMajor";
    if (!fusionAvailable) {
      console.log(
        `FPU_SMOKE_OPENED_FILE=${JSON.stringify({ skipped: "no Fusion", verdict: fusionVersion })}`,
      );
      if (process.env.FPU_SMOKE_REQUIRE_FUSION === "1") {
        throw new Error(
          `FPU_SMOKE_REQUIRE_FUSION=1 but no Fusion binary resolved: ${JSON.stringify(fusionVersion)}`,
        );
      }
      this.skip();
      return;
    }

    // The folder has no root dbt_project.yml and no declared projects, so nothing is declared yet.
    assert.deepStrictEqual(
      await fusionClientStates(),
      [],
      "no Declared Project before a file is opened",
    );

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "smoke workspace should be open");
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(
        vscode.Uri.joinPath(folder.uri, OPENED_MODEL),
      ),
    );

    const report = await waitForProjectRunning();
    console.log(`FPU_SMOKE_OPENED_FILE=${JSON.stringify(report)}`);
    assert.strictEqual(
      report.origin,
      "openedFile",
      "the project should be declared by the opened file",
    );

    await waitForWorkbenchNotificationsToSettle(cdpPort, smokeHost);
    await assertNoWorkbenchNotifications(cdpPort, smokeHost);
    await revealWorkbench(cdpPort, smokeHost);
    const hover = await waitForHover(cdpPort, smokeHost);
    assert.ok(
      hover?.includes(DECLARED_TEXT),
      `the language status should say "${DECLARED_TEXT}": ${hover ?? "no hover"}`,
    );

    await recordCheckpoint(cdpPort, smokeHost, { hover, report });
  });
});

async function fusionClientStates(): Promise<FusionClientStateReport[]> {
  return (
    (await vscode.commands.executeCommand<FusionClientStateReport[]>(
      FUSION_CLIENT_STATES_COMMAND,
    )) ?? []
  );
}

async function waitForProjectRunning(): Promise<FusionClientStateReport> {
  let last: FusionClientStateReport[] = [];
  const { report } = await pollUntil(
    async () => {
      last = await fusionClientStates();
      return {
        report: last.find(
          (candidate) => candidate.projectName === PROJECT_NAME,
        ),
      };
    },
    ({ report }) => report?.state === "running",
    {
      timeoutMs: WAIT_TIMEOUT_MS,
      intervalMs: POLL_MS,
      describe: () => `${PROJECT_NAME} to run: ${JSON.stringify(last)}`,
    },
  );
  return report as FusionClientStateReport;
}

/** The first call opens the language status hover; later calls read its text. */
function waitForHover(
  cdpPort: string,
  host: string,
): Promise<string | undefined> {
  return pollUntil(
    () => evaluateWorkbench<string>(cdpPort, host, LANGUAGE_STATUS_HOVER),
    (text) => text?.includes(DECLARED_TEXT) ?? false,
    {
      timeoutMs: WAIT_TIMEOUT_MS,
      intervalMs: POLL_MS,
      describe: (last) =>
        `the language status hover; last hover was ${JSON.stringify(last)}`,
    },
  );
}

/** Writes one checkpoint with the hover open, when `FPU_SMOKE_SCREENSHOTS` names a directory. */
async function recordCheckpoint(
  cdpPort: string,
  host: string,
  measured: Record<string, unknown>,
): Promise<void> {
  const dir = screenshotDirectory();
  if (!dir) {
    return;
  }
  const fixtureDir = path.join(dir, host, "nested-project");
  const png = await captureWorkbenchScreenshot(cdpPort, host);
  const file = writeCheckpoint(
    fixtureDir,
    checkpointCount(fixtureDir) + 1,
    {
      name: "opened file declares nested project",
      expect:
        "The nested_analytics client status item shows with the language status hover open, " +
        `reading "${DECLARED_TEXT}".`,
      measured,
    },
    png,
    {
      host,
      fixture: currentFixtureName(),
      activeEditor: vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
      capturedAt: new Date().toISOString(),
    },
  );
  console.log(`FPU_SMOKE_SCREENSHOT=${file}`);
}
