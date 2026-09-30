import { ExtensionContext } from "vscode";
import { compose } from "./compositionRoot";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";

let activeExtension: DBTPowerUserExtension | undefined;

export async function activate(context: ExtensionContext) {
  const { extension: dbtPowerUserExtension } = compose(context);

  context.subscriptions.push(dbtPowerUserExtension);
  activeExtension = dbtPowerUserExtension;

  await dbtPowerUserExtension.activate();
}

export async function deactivate(): Promise<void> {
  await activeExtension?.deactivate();
  activeExtension = undefined;
}
