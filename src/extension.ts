import type { ExtensionContext } from "vscode";
import { compose } from "./compositionRoot";
import type { FusionPowerUserExtension } from "./fusionPowerUserExtension";

/** The value `activate` returns, read by test harnesses through `Extension.exports`. */
export interface FusionPowerUserApi {
  /** Settles once project startup finishes or stops; never rejects. */
  ready: Promise<void>;
  /** Milliseconds from `activate` entry until `ready` settled; `undefined` before then. */
  readonly readyMs: number | undefined;
}

let activeExtension: FusionPowerUserExtension | undefined;

export function activate(context: ExtensionContext): FusionPowerUserApi {
  const start = performance.now();
  const { extension } = compose(context);

  context.subscriptions.push(extension);
  activeExtension = extension;

  let readyMs: number | undefined;
  const ready = extension.activate().then(() => {
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
