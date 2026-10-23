import type { LogOutputChannel } from "vscode";
import type { ErrorHandler } from "vscode-languageclient/node";
import { CloseAction, ErrorAction } from "vscode-languageclient/node";
import { hasDbtProjectFile } from "../core/snapshot/index";
import type { FusionProjectRef } from "./fusionClient";

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
  return {
    error: (error, _message, count) => {
      if (inactive()) {
        outputChannel.debug(
          `Connection error after the client stopped or its project was removed: ${error.message}`,
        );
        return { action: ErrorAction.Shutdown, handled: true };
      }
      return {
        action:
          count && count <= 3 ? ErrorAction.Continue : ErrorAction.Shutdown,
        message: `${who()}: connection to server is erroring: ${error.message}`,
      };
    },
    closed: () => {
      if (inactive()) {
        outputChannel.debug(
          "Connection closed after the client stopped or its project was removed.",
        );
        return { action: CloseAction.DoNotRestart, handled: true };
      }
      return {
        action: CloseAction.DoNotRestart,
        message: `${who()}: the server closed the connection and will not be restarted.`,
      };
    },
  };
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
