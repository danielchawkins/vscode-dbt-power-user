/**
 * The measure-runtime warm-up: one launch before the timed launches, selected with `--suites hostWarmUp`.
 * It is the only suite that tolerates the host's slow-start notice. It logs that notice, any other notification and
 * the startup phases, and asserts only that the extension activates. It never calls assertNoWorkbenchNotifications.
 */
import * as assert from "node:assert";
import * as vscode from "vscode";
import { HARNESS_SWITCHES } from "../../settings/environment";
import { readStartupMetrics } from "./activationReport";
import {
  HIDE_NOTIFICATIONS,
  readWorkbenchNotificationTexts,
  SHOW_NOTIFICATIONS,
  validateSmokeHost,
} from "./cdpClient";
import { splitHostNotices } from "./notificationToasts";

const EXTENSION_ID = "danielchawkins.fusion-power-user";

suite("Host warm-up launch", function () {
  test("activates the VSIX and logs its notices and startup phases", async function () {
    const cdpPort = process.env.FPU_CDP_PORT;
    assert.ok(cdpPort, "smoke requires CDP port");
    const smokeHost = validateSmokeHost(
      process.env[HARNESS_SWITCHES.smokeHost] ?? "",
    );
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    const api = await ext.activate();
    await api.ready;
    assert.ok(ext.isActive, "packaged extension should activate");

    let split: ReturnType<typeof splitHostNotices>;
    await vscode.commands.executeCommand(SHOW_NOTIFICATIONS);
    try {
      split = splitHostNotices(
        await readWorkbenchNotificationTexts(cdpPort, smokeHost),
      );
    } finally {
      await vscode.commands.executeCommand(HIDE_NOTIFICATIONS);
    }
    console.log(`FPU_SMOKE_HOST_NOTICE=${JSON.stringify(split.hostNotices)}`);
    console.log(
      `FPU_SMOKE_WARMUP_NOTIFICATIONS=${JSON.stringify(split.unexpected)}`,
    );

    const { phases } = await readStartupMetrics();
    console.log(`FPU_SMOKE_STARTUP_PHASES=${JSON.stringify(phases)}`);
  });
});
