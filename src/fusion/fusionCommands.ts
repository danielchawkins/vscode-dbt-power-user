import type { CancellationToken, Uri } from "vscode";
import {
  COMMAND_DEADLINE_MS,
  type CompileFileResult,
  type CurrentNodeResult,
  FusionCommandError,
  type ListNodesResult,
  type ProjectInfo,
  toCommandError,
  toCompileFileResult,
  toCurrentNodeResult,
  toListNodesResult,
  toProjectInfo,
} from "../core/lsp";
import {
  FUSION_LSP_COMMANDS,
  type FusionClient,
  type FusionClientState,
} from "./fusionLanguageClient";

type FusionCommandsState = FusionClientState | "notRunning";

/**
 * Every server command the extension sends. Calls resolve the project's current client, so a restart never
 * leaves a stale reference. Rejects with {@link FusionCommandError}; `compileFile`, `getCurrentNode` and
 * `listNodes` time out after 5 s. Commands of one class are sent one at a time.
 */
export interface FusionCommands {
  /** `notRunning` when the project has no client. */
  readonly state: FusionCommandsState;
  listNodes(
    selectors: readonly string[],
    token?: CancellationToken,
  ): Promise<ListNodesResult>;
  /** `undefined`: the path is not a node. */
  getCurrentNode(relativePath: string): Promise<CurrentNodeResult | undefined>;
  compileFile(uri: Uri): Promise<CompileFileResult>;
  /** `undefined` until the first compile. */
  getProjectInfo(): Promise<ProjectInfo | undefined>;
}

type QueuedCommand = Exclude<
  (typeof FUSION_LSP_COMMANDS)[keyof typeof FUSION_LSP_COMMANDS],
  "dbt.show"
>;

type Sender = (
  command: QueuedCommand,
  payload: unknown,
  token: CancellationToken | undefined,
) => Promise<unknown>;

/** Sends one command to the project's current client, failing after `deadlineMs`. */
function senderFor(
  clientOf: () => FusionClient | undefined,
  deadlineMs: number,
): Sender {
  return async (command, payload, token) => {
    const client = clientOf();
    if (!client || client.state !== "running") {
      throw new FusionCommandError(
        "notRunning",
        `Fusion LSP client is not running (${client?.state ?? "notRunning"})`,
      );
    }
    if (token?.isCancellationRequested) {
      throw new FusionCommandError("cancelled", "Request cancelled");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new FusionCommandError(
              "timeout",
              `${command} did not answer within ${deadlineMs} ms`,
            ),
          ),
        deadlineMs,
      );
    });
    try {
      const sent = token
        ? client.request<unknown>(command, payload, token)
        : client.request<unknown>(command, payload);
      return await Promise.race([sent, deadline]);
    } catch (error) {
      throw toCommandError(error);
    } finally {
      clearTimeout(timer);
    }
  };
}

export function createFusionCommands(
  clientOf: () => FusionClient | undefined,
  deadlineMs: number = COMMAND_DEADLINE_MS,
): FusionCommands {
  const queues = new Map<QueuedCommand, Promise<unknown>>();
  const send = senderFor(clientOf, deadlineMs);

  const queued = (
    command: QueuedCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<unknown> => {
    const sent = (queues.get(command) ?? Promise.resolve()).then(() =>
      send(command, payload, token),
    );
    queues.set(
      command,
      sent.catch(() => undefined),
    );
    return sent;
  };

  return {
    get state() {
      return clientOf()?.state ?? "notRunning";
    },
    async listNodes(selectors, token) {
      return toListNodesResult(
        await queued(FUSION_LSP_COMMANDS.listNodes, [...selectors], token),
      );
    },
    async getCurrentNode(relativePath) {
      return toCurrentNodeResult(
        await queued(FUSION_LSP_COMMANDS.getCurrentNode, [relativePath]),
      );
    },
    async compileFile(uri) {
      return toCompileFileResult(
        await queued(FUSION_LSP_COMMANDS.compileFile, [uri.toString()]),
      );
    },
    async getProjectInfo() {
      return toProjectInfo(
        await queued(FUSION_LSP_COMMANDS.getProjectInfo, []),
      );
    },
  };
}
