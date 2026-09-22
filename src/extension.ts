import "reflect-metadata";
import { ExtensionContext } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";
import { container } from "./inversify.config";

let activeExtension: DBTPowerUserExtension | undefined;

export async function activate(context: ExtensionContext) {
  registerRuntimeTimings(context);
  const dbtPowerUserExtension = container.get(DBTPowerUserExtension);

  context.subscriptions.push(dbtPowerUserExtension);
  activeExtension = dbtPowerUserExtension;

  await dbtPowerUserExtension.activate(context);
}

export async function deactivate(): Promise<void> {
  await activeExtension?.deactivate();
  activeExtension = undefined;
}
