import type { CancellationToken } from "vscode";
import {
  ExecuteCommandRequest,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import {
  prefixedCommand,
  type FusionClientState,
  type FusionLspCommand,
} from "./fusionClient";
import { commandArguments, type ClientHandle } from "./lspClientSupport";

/** What a request reads from its client when it is sent. */
interface RequestTarget {
  readonly client: ClientHandle | undefined;
  readonly state: FusionClientState;
  readonly commandPrefix: string;
  readonly uriConverters: LanguageClientOptions["uriConverters"];
}

/** Sends `workspace/executeCommand` for one client. FusionCommands decides when each request is sent. */
export class FusionRequests {
  private readonly target: () => RequestTarget;

  constructor(target: () => RequestTarget) {
    this.target = target;
  }

  request<T>(
    command: FusionLspCommand,
    payload: unknown,
    token?: CancellationToken,
  ): Promise<T> {
    const { client, state, commandPrefix, uriConverters } = this.target();
    if (!client) {
      return Promise.reject(
        new Error(`Fusion LSP client is not running (${state})`),
      );
    }
    const args =
      payload === undefined ? [] : Array.isArray(payload) ? payload : [payload];
    return client.sendRequest(
      ExecuteCommandRequest.type,
      {
        command: prefixedCommand(commandPrefix, command),
        arguments: commandArguments(command, args, uriConverters),
      },
      token,
    ) as Promise<T>;
  }
}
