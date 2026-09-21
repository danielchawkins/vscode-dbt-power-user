import "reflect-metadata";
import { ExtensionContext } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import { container } from "./inversify.config";

export async function activate(context: ExtensionContext) {
  registerRuntimeTimings(context);
  const dbtPowerUserExtension = container.get(DBTPowerUserExtension);

  context.subscriptions.push(dbtPowerUserExtension);

  await dbtPowerUserExtension.activate(context);
}

export function deactivate() {}
