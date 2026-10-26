import * as assert from "node:assert";
import { HARNESS_SWITCHES } from "../../settings/environment";
import type { SmokeHost } from "./cdpClient";
import { validateSmokeHost } from "./cdpClient";

/** The CDP port the smoke host exposed, which every webview read needs. Fails when the harness did not set it. */
export function cdpPort(): string {
  const port = process.env.FPU_CDP_PORT;
  assert.ok(port, "smoke requires CDP port");
  return port;
}

/** The smoke host the harness named, validated. */
export function smokeHost(): SmokeHost {
  return validateSmokeHost(process.env[HARNESS_SWITCHES.smokeHost] ?? "");
}
