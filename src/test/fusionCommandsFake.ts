import type { CancellationToken } from "vscode";
import {
  FusionCommandError,
  toCommandError,
  toCompileFileResult,
  toCurrentNodeResult,
  toListNodesResult,
  toProjectInfo,
} from "../core/lsp";
import type { FusionClient } from "../fusion/fusionClient";
import { FUSION_LSP_COMMANDS } from "../fusion/fusionClient";
import type { FusionCommands } from "../fusion/fusionCommands";

/**
 * A FusionCommands that sends each call to the client's `request` at once, with no lanes, retries or ceilings.
 * The lane's behaviour is tested against `createFusionCommands` in fusionCommands.test.ts.
 */
export function fakeFusionCommands(
  clientOf: () => FusionClient | undefined,
): FusionCommands {
  const send = async (
    command: keyof typeof FUSION_LSP_COMMANDS,
    payload: unknown,
    token: CancellationToken | undefined,
  ) => {
    const client = clientOf();
    if (client?.state !== "running") {
      throw new FusionCommandError(
        "notRunning",
        `Fusion LSP client is not running (${client?.state ?? "notRunning"})`,
      );
    }
    return client
      .request(FUSION_LSP_COMMANDS[command], payload, token)
      .catch((error: unknown) => {
        throw toCommandError(error);
      });
  };
  return {
    get state() {
      return clientOf()?.state ?? "notRunning";
    },
    get compilePhase() {
      return clientOf()?.compileState.phase ?? "idle";
    },
    async listNodes(selectors, request) {
      return toListNodesResult(
        await send("listNodes", [...selectors], request.token),
      );
    },
    async getCurrentNode(relativePath, request) {
      return toCurrentNodeResult(
        await send("getCurrentNode", [relativePath], request.token),
      );
    },
    async compileFile(uri, request) {
      return toCompileFileResult(
        await send("compileFile", [uri.toString()], request.token),
      );
    },
    async getProjectInfo(request) {
      return toProjectInfo(await send("getProjectInfo", [], request.token));
    },
  };
}
