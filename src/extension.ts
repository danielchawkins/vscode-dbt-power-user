import { ExtensionContext } from "vscode";
import { compose } from "./compositionRoot";
import { DBTPowerUserExtension } from "./dbtPowerUserExtension";

/** The value `activate` returns, read by test harnesses through `Extension.exports`. */
export interface FusionPowerUserApi {
  /** Settles once project startup finishes or stops; never rejects. */
  ready: Promise<void>;
  /** Milliseconds from `activate` entry until `ready` settled; `undefined` before then. */
  readonly readyMs: number | undefined;
}

let activeExtension: DBTPowerUserExtension | undefined;

export function activate(context: ExtensionContext): FusionPowerUserApi {
  const start = performance.now();
  const { extension: dbtPowerUserExtension } = compose(context);

  context.subscriptions.push(dbtPowerUserExtension);
  activeExtension = dbtPowerUserExtension;

  let readyMs: number | undefined;
  const ready = dbtPowerUserExtension.activate().then(() => {
    readyMs = performance.now() - start;
  });
  return {
    ready,
    get readyMs() {
      return readyMs;
    },
  };
}

export async function deactivate(): Promise<void> {
  await activeExtension?.deactivate();
  activeExtension = undefined;
}
