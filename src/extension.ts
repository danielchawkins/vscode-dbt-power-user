import "reflect-metadata";
import { ExtensionContext } from "vscode";
import { registerRuntimeTimings } from "./benchmark/runtimeTimings";
import { compose } from "./compositionRoot";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";

let activeExtension: DBTPowerUserExtension | undefined;

export async function activate(context: ExtensionContext) {
  registerRuntimeTimings(context);
  const { extension: dbtPowerUserExtension } = compose(context);

  context.subscriptions.push(dbtPowerUserExtension);
  activeExtension = dbtPowerUserExtension;

  await dbtPowerUserExtension.activate(context);
}

export async function deactivate(): Promise<void> {
  await activeExtension?.deactivate();
  activeExtension = undefined;
}
