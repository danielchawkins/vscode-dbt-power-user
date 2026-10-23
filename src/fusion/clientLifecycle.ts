import type { LogOutputChannel, Uri } from "vscode";
import type { ErrorHandler } from "vscode-languageclient/node";
import { CloseAction, ErrorAction } from "vscode-languageclient/node";
import { hasDbtProjectFile } from "../core/snapshot/index";
import type { FusionClientOptions, FusionProjectRef } from "./fusionClient";

/**
 * The error handler of one Declared Project's client. A connection error or close while the client is stopping or
 * stopped, or after the project's file is gone, is logged at debug and shuts the client down without a notification.
 * Other errors notify with a message that names the project root; the server is not restarted either way.
 */
export function clientErrorHandler(input: {
  project: FusionProjectRef;
  outputChannel: LogOutputChannel;
  isInactive: () => boolean;
}): ErrorHandler {
  const { project, outputChannel, isInactive } = input;
  const inactive = (): boolean =>
    isInactive() || !hasDbtProjectFile(project.root.fsPath);
  const who = (): string =>
    `Fusion client ${project.name} (${project.root.fsPath})`;
  // `handled` stops the library from notifying. It still writes `message` to the output channel, so the message is
  // this line rather than the library's default text.
  const silenced = (detail: string): string => {
    const message = `${who()} is stopped or its project root is gone; ${detail}`;
    outputChannel.debug(message);
    return message;
  };
  return {
    error: (error, _message, count) => {
      if (inactive()) {
        return {
          action: ErrorAction.Shutdown,
          handled: true,
          message: silenced(`connection error: ${error.message}`),
        };
      }
      return {
        action:
          count && count <= 3 ? ErrorAction.Continue : ErrorAction.Shutdown,
        message: `${who()}: connection to server is erroring: ${error.message}`,
      };
    },
    closed: () => {
      if (inactive()) {
        return {
          action: CloseAction.DoNotRestart,
          handled: true,
          message: silenced("connection closed"),
        };
      }
      return {
        action: CloseAction.DoNotRestart,
        message: `${who()}: the server closed the connection and will not be restarted.`,
      };
    },
  };
}

/**
 * Whether a client may start or restart: its project file must still be on disk. Otherwise logs one debug line, and
 * the caller stops the client for good; the registry drops the project. `exists` defaults to the file system.
 */
export function projectFileAvailable(
  {
    project,
    outputChannel,
  }: Pick<FusionClientOptions, "project" | "outputChannel">,
  exists: (root: Uri) => boolean = (root) => hasDbtProjectFile(root.fsPath),
): boolean {
  if (exists(project.root)) {
    return true;
  }
  outputChannel.debug(
    `Not starting Fusion LSP for ${project.name}: ${project.root.fsPath} has no dbt_project file`,
  );
  return false;
}

/**
 * Returns a check that drops one notification method while the client is inactive. The first drop logs one debug line
 * to the project's output channel, so a burst of dropped notifications does not flood it.
 */
export function inactiveGate(
  isInactive: () => boolean,
  outputChannel: LogOutputChannel,
): (method: string) => boolean {
  let droppedLogged = false;
  return (method) => {
    if (!isInactive()) {
      return false;
    }
    if (!droppedLogged) {
      droppedLogged = true;
      outputChannel.debug(
        `Dropped ${method} and later notifications: the client is stopping or stopped`,
      );
    }
    return true;
  };
}
