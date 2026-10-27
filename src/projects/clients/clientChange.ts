import type { Event } from "vscode";
import { Disposable } from "vscode";
import type { CompileComplete } from "../../fusion/compileSignal";
import type { FusionClient } from "../../fusion/fusionClient";
import type { DeclaredProject } from "../registry/projectRegistry";
import type { FusionClientPool } from "./fusionClientPool";

/**
 * Calls `listener` with each compile of the client that `client` returns. The subscription moves to the new client
 * each time `clientChanged` fires.
 */
export function followClientCompiles(
  client: () => FusionClient | undefined,
  clientChanged: Event<void>,
  listener: (complete: CompileComplete) => void,
): Disposable {
  let subscription: Disposable | undefined;
  const follow = () => {
    subscription?.dispose();
    subscription = client()?.compileState.onDidComplete(listener);
  };
  follow();
  return Disposable.from(clientChanged(follow), {
    dispose: () => subscription?.dispose(),
  });
}

/** Fires when the project's client is replaced or changes state. */
export function onClientChange(
  pool: FusionClientPool,
  project: DeclaredProject,
): Event<void> {
  return (listener) => {
    let stateSubscription: Disposable | undefined;
    const follow = () => {
      stateSubscription?.dispose();
      stateSubscription = pool.get(project)?.onDidChangeState(() => listener());
    };
    follow();
    const replaced = pool.onDidChangeClients(() => {
      follow();
      listener();
    });
    return Disposable.from(replaced, {
      dispose: () => stateSubscription?.dispose(),
    });
  };
}

/** Fires when the Current Project switches, or its client is replaced or changes state. */
export function onCurrentClientChange(
  pool: FusionClientPool,
  current: {
    readonly current: DeclaredProject | undefined;
    readonly onDidChangeCurrent: Event<unknown>;
  },
): Event<void> {
  return (listener) => {
    let clientChange: Disposable | undefined;
    const follow = () => {
      clientChange?.dispose();
      const project = current.current;
      clientChange = project && onClientChange(pool, project)(listener);
    };
    follow();
    const switched = current.onDidChangeCurrent(() => {
      follow();
      listener();
    });
    return Disposable.from(switched, {
      dispose: () => clientChange?.dispose(),
    });
  };
}
