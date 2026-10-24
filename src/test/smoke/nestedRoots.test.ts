import * as assert from "node:assert";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FusionClientStateReport } from "../../projects/clients/fusionClientDiagnostics";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { checkFusionVersion } from "../integration/helpers/testFixtures";
import {
  assertNoWorkbenchNotifications,
  captureWorkbenchScreenshot,
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

const OUTER = "outer";
const INNER = "inner";
const OUTER_MODEL = "models/outer_model.sql";
const INNER_MODEL = "inner/models/inner_model.sql";
const WAIT_TIMEOUT_MS = 45_000;
const POLL_MS = 250;

suite("Nested-root smoke", function () {
  // Bounded waits: published 45s, notifications 30s, reveal 30s. The limit covers their sum plus 30s of headroom.
  this.timeout(135_000);

  test("keeps a nested project's document out of the outer project's client", async function () {
    if (currentFixtureName() !== "nested-roots") {
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
      if (process.env.FPU_SMOKE_REQUIRE_FUSION === "1") {
        throw new Error(
          `FPU_SMOKE_REQUIRE_FUSION=1 but no Fusion binary resolved: ${JSON.stringify(fusionVersion)}`,
        );
      }
      this.skip();
      return;
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "smoke workspace should be open");
    for (const model of [OUTER_MODEL, INNER_MODEL]) {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(
          vscode.Uri.joinPath(folder.uri, model),
        ),
      );
    }

    const states = await waitForPublished();
    const innerFile = vscode.Uri.joinPath(folder.uri, INNER_MODEL).fsPath;
    const outerFile = vscode.Uri.joinPath(folder.uri, OUTER_MODEL).fsPath;
    const outerReport = states.get(OUTER);
    const innerReport = states.get(INNER);
    assert.ok(outerReport && innerReport, "both clients should run");
    const innerOpen = innerReport.openDocuments.includes(innerFile);
    const outerOpen = outerReport.openDocuments.includes(innerFile);
    const outerHoldsOuterModel = outerReport.openDocuments.includes(outerFile);
    const outerInnerDiagnostics = outerReport.diagnosticCounts[innerFile] ?? 0;
    const measured = {
      innerOpen,
      outerOpen,
      outerHoldsOuterModel,
      outerInnerDiagnostics,
      notifications: [],
    };
    console.log(`FPU_SMOKE_NESTED_ROOTS=${JSON.stringify(measured)}`);
    assert.ok(innerOpen, "inner should hold inner_model.sql open");
    assert.ok(!outerOpen, "outer should not hold inner_model.sql open");
    assert.ok(
      outerHoldsOuterModel,
      "outer should hold outer_model.sql open, so the check above has a positive control",
    );
    assert.strictEqual(
      outerInnerDiagnostics,
      0,
      "outer should publish no diagnostics for inner_model.sql",
    );

    await waitForWorkbenchNotificationsToSettle(cdpPort, smokeHost);
    await assertNoWorkbenchNotifications(cdpPort, smokeHost);
    await revealWorkbench(cdpPort, smokeHost);
    await recordCheckpoint(cdpPort, smokeHost, measured);
  });
});

/**
 * Both clients are running and each has completed a compile, and either client has published diagnostics. A server
 * publishes only for files with diagnostics, so a clean model has no entry of its own; any publish shows the server has
 * processed its compile. Reading the outer client's counts before that would pass vacuously.
 */
async function waitForPublished(): Promise<
  Map<string, FusionClientStateReport>
> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let last: FusionClientStateReport[] = [];
  do {
    last = await fusionClientStates();
    const ready = last.filter(
      (report) => report.state === "running" && report.compiles > 0,
    );
    const byName = new Map(ready.map((report) => [report.projectName, report]));
    const outer = byName.get(OUTER);
    const inner = byName.get(INNER);
    if (outer && inner && (publishedAny(outer) || publishedAny(inner))) {
      return byName;
    }
    await sleep(POLL_MS);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${OUTER} and ${INNER} to compile and publish: ${JSON.stringify(last)}`,
  );
}

function publishedAny(report: FusionClientStateReport): boolean {
  return Object.keys(report.diagnosticCounts).length > 0;
}

async function fusionClientStates(): Promise<FusionClientStateReport[]> {
  return (
    (await vscode.commands.executeCommand<FusionClientStateReport[]>(
      FUSION_CLIENT_STATES_COMMAND,
    )) ?? []
  );
}

/** Writes one checkpoint with the nested model open, when `FPU_SMOKE_SCREENSHOTS` names a directory. */
async function recordCheckpoint(
  cdpPort: string,
  host: string,
  measured: Record<string, unknown>,
): Promise<void> {
  const dir = screenshotDirectory();
  if (!dir) {
    return;
  }
  const fixtureDir = path.join(dir, host, "nested-roots");
  const png = await captureWorkbenchScreenshot(cdpPort, host);
  const file = writeCheckpoint(
    fixtureDir,
    checkpointCount(fixtureDir) + 1,
    {
      name: "nested model stays out of the outer client",
      expect:
        "inner's openDocuments lists inner_model.sql; outer's openDocuments lists outer_model.sql and not " +
        "inner_model.sql; outer publishes no diagnostics for inner_model.sql; no workbench notification appeared.",
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
