import type { CancellationToken, Disposable, Uri } from "vscode";
import {
  type CompileFileResult,
  type CurrentNodeResult,
  ceilingMessage,
  FusionCommandError,
  type ListNodesResult,
  type ProjectInfo,
  REQUEST_POLICIES,
  type RequestPurpose,
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
} from "./fusionClient";

type FusionCommandsState = FusionClientState | "notRunning";

/** Why a request is sent, which picks its RequestPolicy, and the caller's token, which ends the wait early. */
interface RequestOptions {
  readonly purpose: RequestPurpose;
  readonly token?: CancellationToken;
}

/**
 * Every server command the extension sends. Calls resolve the project's current client, so a restart never
 * leaves a stale reference. Rejects with {@link FusionCommandError}: `timeout` when the purpose's ceiling passes,
 * `cancelled` when the caller's token is cancelled. Commands of one class are sent one at a time.
 */
export interface FusionCommands {
  /** `notRunning` when the project has no client. */
  readonly state: FusionCommandsState;
  listNodes(
    selectors: readonly string[],
    request: RequestOptions,
  ): Promise<ListNodesResult>;
  /** `undefined`: the path is not a node. */
  getCurrentNode(
    relativePath: string,
    request: RequestOptions,
  ): Promise<CurrentNodeResult | undefined>;
  compileFile(uri: Uri, request: RequestOptions): Promise<CompileFileResult>;
  /** `undefined` until the first compile. */
  getProjectInfo(request: RequestOptions): Promise<ProjectInfo | undefined>;
}

type QueuedCommand = Exclude<
  (typeof FUSION_LSP_COMMANDS)[keyof typeof FUSION_LSP_COMMANDS],
  "dbt.show"
>;

type Sender = (
  command: QueuedCommand,
  payload: unknown,
  request: RequestOptions,
) => Promise<unknown>;

/**
 * Sends one command to the project's current client. The wait ends when the server answers, when the purpose's
 * ceiling passes, or when the caller's token is cancelled.
 */
function senderFor(clientOf: () => FusionClient | undefined): Sender {
  return async (command, payload, { purpose, token }) => {
    const client = clientOf();
    if (client?.state !== "running") {
      throw new FusionCommandError(
        "notRunning",
        `Fusion LSP client is not running (${client?.state ?? "notRunning"})`,
      );
    }
    if (token?.isCancellationRequested) {
      throw new FusionCommandError("cancelled", "Request cancelled");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let subscription: Disposable | undefined;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        // The ceiling rejects the caller and leaves the server request running; no token reaches the server here.
        timer = setTimeout(
          () =>
            reject(new FusionCommandError("timeout", ceilingMessage(purpose))),
          REQUEST_POLICIES[purpose].ceilingMs,
        );
        subscription = token?.onCancellationRequested(() =>
          reject(new FusionCommandError("cancelled", "Request cancelled")),
        );
        const sent = token
          ? client.request<unknown>(command, payload, token)
          : client.request<unknown>(command, payload);
        sent.then(resolve, reject);
      });
    } catch (error) {
      throw toCommandError(error);
    } finally {
      clearTimeout(timer);
      subscription?.dispose();
    }
  };
}

export function createFusionCommands(
  clientOf: () => FusionClient | undefined,
): FusionCommands {
  const queues = new Map<QueuedCommand, Promise<unknown>>();
  const send = senderFor(clientOf);

  const queued = (
    command: QueuedCommand,
    payload: unknown,
    request: RequestOptions,
  ): Promise<unknown> => {
    const sent = (queues.get(command) ?? Promise.resolve()).then(() =>
      send(command, payload, request),
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
    async listNodes(selectors, request) {
      return toListNodesResult(
        await queued(FUSION_LSP_COMMANDS.listNodes, [...selectors], request),
      );
    },
    async getCurrentNode(relativePath, request) {
      return toCurrentNodeResult(
        await queued(
          FUSION_LSP_COMMANDS.getCurrentNode,
          [relativePath],
          request,
        ),
      );
    },
    async compileFile(uri, request) {
      return toCompileFileResult(
        await queued(
          FUSION_LSP_COMMANDS.compileFile,
          [uri.toString()],
          request,
        ),
      );
    },
    async getProjectInfo(request) {
      return toProjectInfo(
        await queued(FUSION_LSP_COMMANDS.getProjectInfo, [], request),
      );
    },
  };
}
