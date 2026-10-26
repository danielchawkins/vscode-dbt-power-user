import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { FusionClientStateReport } from "../../projects/clients/fusionClientDiagnostics";
import { FUSION_CLIENT_STATES_COMMAND } from "../../projects/clients/fusionClientDiagnostics";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { pollUntil, sleep } from "../async";
import {
  captureWorkbenchScreenshot,
  readWorkbenchNotificationTexts,
  validateSmokeHost,
  waitForWorkbenchNotificationsToSettle,
} from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";
import {
  checkpointCount,
  screenshotDirectory,
  writeCheckpoint,
} from "./visualEvidence";

const TOOL_ENV_PREFIX = "tool-env-";
const CLIENT_WAIT_TIMEOUT_MS = 45_000;
const LOG_WAIT_TIMEOUT_MS = 10_000;
const POLL_MS = 250;
const DISABLED_SETTLE_MS = 5_000;

/** What one fixture observed after its model opened. */
interface Observed {
  reports: FusionClientStateReport[];
  notifications: string[];
  /** The fixture root, resolved through any temporary-directory link. */
  workspace: string;
  /** Realpaths of the forwarders that ran, in order; undefined when invocations.log was never written. */
  forwarders: string[] | undefined;
  /** The decoy `dbt` on the host PATH; the host runs it when no tool environment applies. */
  decoyDbt: string;
  /** Whether mise or direnv resolves on the host PATH. */
  hostToolsFound: string[];
  /** Whether a log file under FPU_SMOKE_LOGS_DIR holds `logNeedle`; undefined when the row has none. */
  logNotice: boolean | undefined;
}

interface ToolEnvRow {
  /** What the checkpoint should show; the reviewer compares this with the image. */
  expect: string;
  /** Text that must appear in a *.log file under FPU_SMOKE_LOGS_DIR. */
  logNeedle?: string;
  check(observed: Observed): void;
}

/** One row per entry in scripts/smoke/toolEnvFixtures.mjs. */
const ROWS = new Map<string, ToolEnvRow>([
  [
    "mise",
    {
      expect:
        "Client running; source mise; executable under bin/; invocations.log names bin/dbt; no too-old verdict; " +
        "no mise trust hint.",
      check(o: Observed) {
        const report = single(o);
        assertRunning(report);
        assert.strictEqual(report.environmentSource, "mise");
        assertRanFrom(o, report, "bin");
        assertForwarderRan(o, "bin");
        assertNoTooOld(report);
        assertTrustHint(o, false);
      },
    },
  ],
  [
    "direnv",
    {
      expect:
        "Client running; source direnv; executable under bin/; invocations.log names bin/dbt; no too-old verdict; " +
        "no mise trust hint.",
      check(o: Observed) {
        const report = single(o);
        assertRunning(report);
        assert.strictEqual(report.environmentSource, "direnv");
        assertRanFrom(o, report, "bin");
        assertForwarderRan(o, "bin");
        assertNoTooOld(report);
        assertTrustHint(o, false);
      },
    },
  ],
  [
    "untrusted",
    {
      expect:
        "Client failed with the decoy dbt 2.0.5 from PATH, too old; source host; mise trust hint notification shown.",
      check(o: Observed) {
        assertTooOldFromPath(o, single(o));
        assertTrustHint(o, true);
      },
    },
  ],
  [
    "none",
    {
      expect:
        "Client failed with the decoy dbt 2.0.5 from PATH, too old; source host; no mise trust hint; " +
        "mise and direnv absent from PATH.",
      check(o: Observed) {
        assertTooOldFromPath(o, single(o));
        assertTrustHint(o, false);
        assert.deepStrictEqual(o.hostToolsFound, []);
      },
    },
  ],
  [
    "disabled",
    {
      expect:
        "No Declared Project and no client; invocations.log never written; no workbench notification.",
      check(o: Observed) {
        assert.deepStrictEqual(o.reports, []);
        assert.strictEqual(o.forwarders, undefined);
        assertTrustHint(o, false);
      },
    },
  ],
  [
    "projectdir",
    {
      expect:
        "Client running; the ignored DBT_ENGINE_PROJECT_DIR line in the status detail and in the project log; " +
        "no notification; --project-dir is the fixture root.",
      logNeedle: "is ignored for",
      check(o: Observed) {
        const report = single(o);
        assertRunning(report);
        assertRanFrom(o, report, "bin");
        assertForwarderRan(o, "bin");
        assert.ok(report.projectDir, "no --project-dir reported");
        assert.strictEqual(realOrSelf(report.projectDir), o.workspace);
        assert.ok(
          report.statusDetail?.includes("is ignored for"),
          `status detail: ${report.statusDetail}`,
        );
        assert.strictEqual(
          o.logNotice,
          true,
          "project log has no ignored-variable line",
        );
        assert.ok(
          o.notifications.every(
            (text) => !text.includes("DBT_ENGINE_PROJECT_DIR"),
          ),
          `notification: ${JSON.stringify(o.notifications)}`,
        );
      },
    },
  ],
]);

suite("Tool-environment smoke", function () {
  // Bounded waits: client states 45s, then notifications 30s, plus the screenshot and the log poll.
  this.timeout(150_000);

  test("the fixture resolves the tool environment its table row names", async function () {
    const name = currentFixtureName();
    if (!name?.startsWith(TOOL_ENV_PREFIX)) {
      this.skip();
      return;
    }
    const key = name.slice(TOOL_ENV_PREFIX.length);
    const row = ROWS.get(key);
    assert.ok(row, `unknown tool-environment fixture ${name}`);

    const cdpPort = process.env.FPU_CDP_PORT;
    assert.ok(cdpPort, "smoke requires CDP port");
    const smokeHost = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const resultsDir = process.env.FPU_SMOKE_RESULTS;
    assert.ok(resultsDir, "smoke requires FPU_SMOKE_RESULTS");
    const toolEnvTmp = process.env.FPU_SMOKE_TOOLENV_TMP;
    assert.ok(toolEnvTmp, "smoke requires FPU_SMOKE_TOOLENV_TMP");
    const logsDir = process.env.FPU_SMOKE_LOGS_DIR;
    assert.ok(logsDir, "smoke requires FPU_SMOKE_LOGS_DIR");
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "tool-environment fixture opens as a folder");

    const model = vscode.Uri.file(
      path.join(folder.uri.fsPath, "models", "model.sql"),
    );
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(model),
    );
    const reports = await waitForClients(key === "disabled");
    // The untrusted row expects its trust hint to stay, so wait for it to appear rather than for the list to clear.
    const notifications =
      key === "untrusted"
        ? await waitForNotificationText(cdpPort, smokeHost, "mise trust")
        : (await waitForWorkbenchNotificationsToSettle(cdpPort, smokeHost),
          await readWorkbenchNotificationTexts(cdpPort, smokeHost));
    const observed: Observed = {
      reports,
      notifications,
      workspace: fs.realpathSync(folder.uri.fsPath),
      forwarders: readForwarders(toolEnvTmp),
      decoyDbt: realOrSelf(path.join(toolEnvTmp, "decoy-bin", "dbt")),
      hostToolsFound: ["mise", "direnv"].filter(
        (tool) => onPath(tool) !== undefined,
      ),
      logNotice: row.logNeedle
        ? await waitForLogLine(logsDir, row.logNeedle)
        : undefined,
    };
    row.check(observed);

    const screenshots = screenshotDirectory();
    if (screenshots) {
      const fixtureDir = path.join(screenshots, smokeHost, name);
      const png = await captureWorkbenchScreenshot(cdpPort, smokeHost);
      const file = writeCheckpoint(
        fixtureDir,
        checkpointCount(fixtureDir) + 1,
        {
          name: `${key} resolved`,
          expect: row.expect,
          measured: { reports, notifications: observed.notifications },
        },
        png,
        {
          host: smokeHost,
          fixture: name,
          activeEditor:
            vscode.window.activeTextEditor?.document.uri.fsPath ?? null,
          capturedAt: new Date().toISOString(),
        },
      );
      console.log(`FPU_SMOKE_SCREENSHOT=${file}`);
    }
    // Written last, so a failing run leaves no evidence behind.
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(
      path.join(resultsDir, "toolEnvironment.json"),
      `${JSON.stringify({ fixture: name, passed: true }, null, 2)}\n`,
    );
  });
});

async function readReports(): Promise<FusionClientStateReport[]> {
  return (
    (await vscode.commands.executeCommand<FusionClientStateReport[]>(
      FUSION_CLIENT_STATES_COMMAND,
    )) ?? []
  );
}

/** Polls the workbench notifications until one contains `text`, or for 30s; returns the last read. */
async function waitForNotificationText(
  cdpPort: string,
  smokeHost: string,
  text: string,
): Promise<string[]> {
  const deadline = Date.now() + 30_000;
  let texts: string[] = [];
  do {
    texts = await readWorkbenchNotificationTexts(cdpPort, smokeHost);
    if (texts.some((entry) => entry.includes(text))) {
      return texts;
    }
    await sleep(POLL_MS);
  } while (Date.now() < deadline);
  return texts;
}

/** Waits until every client has run or failed; a disabled fixture starts none, so it waits a fixed settle time. */
async function waitForClients(
  disabled: boolean,
): Promise<FusionClientStateReport[]> {
  if (disabled) {
    await sleep(DISABLED_SETTLE_MS);
    return readReports();
  }
  return pollUntil(
    readReports,
    (last) =>
      last.length > 0 &&
      last.every((r) => r.state === "running" || r.state === "failed"),
    {
      timeoutMs: CLIENT_WAIT_TIMEOUT_MS,
      intervalMs: POLL_MS,
      describe: (last) => `no client settled: ${JSON.stringify(last)}`,
    },
  );
}

function single(o: Observed): FusionClientStateReport {
  assert.strictEqual(
    o.reports.length,
    1,
    `expected one Declared Project: ${JSON.stringify(o.reports)}`,
  );
  return o.reports[0];
}

function assertRunning(report: FusionClientStateReport): void {
  assert.strictEqual(
    report.state,
    "running",
    `client state: ${JSON.stringify(report)}`,
  );
}

function assertNoTooOld(report: FusionClientStateReport): void {
  assert.ok(
    !report.failureReason?.includes("too old"),
    `unexpected too-old verdict: ${report.failureReason}`,
  );
}

/** The executable resolved under `<fixture>/<dir>/`, the bin of the chosen tool environment. */
function assertRanFrom(
  o: Observed,
  report: FusionClientStateReport,
  dir: string,
): void {
  assert.ok(report.executablePath, "no executable path reported");
  const executable = fs.realpathSync(report.executablePath);
  const expectedDir = path.join(o.workspace, dir) + path.sep;
  assert.ok(
    executable.startsWith(expectedDir),
    `${executable} is not under ${expectedDir}`,
  );
}

function assertForwarderRan(o: Observed, dir: string): void {
  const forwarder = path.join(o.workspace, dir, "dbt");
  assert.ok(
    o.forwarders?.includes(forwarder),
    `invocations.log lacks ${forwarder}: ${JSON.stringify(o.forwarders)}`,
  );
}

/** The decoy `dbt` on the host PATH fails the version floor; the verdict names it as from PATH. */
function assertTooOldFromPath(
  o: Observed,
  report: FusionClientStateReport,
): void {
  assert.strictEqual(report.state, "failed", JSON.stringify(report));
  assert.ok(
    report.failureReason?.includes("too old") &&
      report.failureReason.includes("(from PATH)"),
    `failure reason: ${report.failureReason}`,
  );
  assert.strictEqual(report.environmentSource, "host");
  // A too-old dbt fails before launch, so only the failure reason names the executable.
  const rejected = /at (\S+) \(from PATH\)/.exec(
    report.failureReason ?? "",
  )?.[1];
  assert.ok(rejected, `no executable path in: ${report.failureReason}`);
  assert.strictEqual(fs.realpathSync(rejected), o.decoyDbt);
}

function assertTrustHint(o: Observed, present: boolean): void {
  const has = o.notifications.some((text) => text.includes("mise trust"));
  assert.strictEqual(
    has,
    present,
    `mise trust hint ${present ? "missing" : "unexpected"}: ${JSON.stringify(o.notifications)}`,
  );
}

/** Forwarder paths from invocations.log, resolved; undefined when the log was never written. */
function readForwarders(tmp: string): string[] | undefined {
  const log = path.join(tmp, "invocations.log");
  if (!fs.existsSync(log)) {
    return undefined;
  }
  return fs
    .readFileSync(log, "utf-8")
    .split("\n")
    .filter((line) => line !== "")
    .map(realOrSelf);
}

function realOrSelf(file: string): string {
  return fs.existsSync(file) ? fs.realpathSync(file) : file;
}

/** The first executable named `name` on the host PATH; undefined when there is none. */
function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.resolve(dir || ".", name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not an executable here; keep looking along PATH.
    }
  }
  return undefined;
}

async function waitForLogLine(dir: string, needle: string): Promise<boolean> {
  const deadline = Date.now() + LOG_WAIT_TIMEOUT_MS;
  do {
    if (logFileContains(dir, needle)) {
      return true;
    }
    await sleep(POLL_MS);
  } while (Date.now() < deadline);
  return false;
}

function logFileContains(dir: string, needle: string): boolean {
  if (!fs.existsSync(dir)) {
    return false;
  }
  return fs.readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return logFileContains(file, needle);
    }
    return (
      entry.name.endsWith(".log") &&
      fs.readFileSync(file, "utf-8").includes(needle)
    );
  });
}
