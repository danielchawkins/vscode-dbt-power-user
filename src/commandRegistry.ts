import { commands, Disposable } from "vscode";
import type { StartupGate } from "./startupGate";

/** Registers a command whose handler runs once extension startup has settled. */
export type RegisterCommand = (
  command: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors `commands.registerCommand`
  handler: (...args: any[]) => unknown,
) => Disposable;

export function gatedRegister(
  startupGate: Pick<StartupGate, "whenSettled">,
): RegisterCommand {
  return (command, handler) =>
    commands.registerCommand(command, async (...args: unknown[]) => {
      await startupGate.whenSettled();
      return handler(...args);
    });
}
