import * as assert from "assert";
import "reflect-metadata";
import * as vscode from "vscode";
import {
  FUSION_CLIENT_STATES_COMMAND,
  FusionClientStateReport,
} from "../../lsp/fusionClientDiagnostics";
import { checkFusionVersion } from "../integration/helpers/testFixtures";
import { assertNoWorkbenchNotifications, validateSmokeHost } from "./cdpClient";
import { currentFixtureName } from "./fixtureContext";

const EXTENSION_ID = "danielchawkins.fusion-power-user";
const EXPECTED_PROJECT_NAMES = ["general", "sox"];
const LSP_WAIT_TIMEOUT_MS = 45_000;
const LSP_WAIT_POLL_MS = 100;

suite("Multi-root LSP smoke", function () {
  this.timeout(90_000);

  test("completes the Fusion LSP initialize handshake for every Declared Project", async function () {
    if (currentFixtureName() !== "multi-root") {
      this.skip();
      return;
    }

    const cdpPort = process.env.FPU_CDP_PORT;
    assert.ok(cdpPort, "smoke requires CDP port");
    const smokeHost = validateSmokeHost(process.env.FPU_SMOKE_HOST ?? "");

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "packaged extension should be installed");
    await ext.activate();
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
      [...EXPECTED_PROJECT_NAMES].sort(),
      "expected one Fusion LSP client per Declared Project",
    );
    for (const state of states) {
      assert.strictEqual(
        state.state,
        "running",
        `${state.projectName} Fusion LSP initialize handshake should complete: ${state.failureReason ?? ""}`,
      );
    }

    await assertNoWorkbenchNotifications(cdpPort, smokeHost);
  });
});

async function waitForFusionClientStates(): Promise<FusionClientStateReport[]> {
  const deadline = Date.now() + LSP_WAIT_TIMEOUT_MS;
  let last: FusionClientStateReport[] = [];
  do {
    last = await vscode.commands.executeCommand<FusionClientStateReport[]>(
      FUSION_CLIENT_STATES_COMMAND,
    );
    if (
      last.length === EXPECTED_PROJECT_NAMES.length &&
      last.every(
        (state) => state.state === "running" || state.state === "failed",
      )
    ) {
      return last;
    }
    await sleep(LSP_WAIT_POLL_MS);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for the Fusion LSP initialize handshake: ${JSON.stringify(last)}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
