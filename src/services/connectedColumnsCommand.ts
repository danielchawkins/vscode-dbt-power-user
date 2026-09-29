import { commands, Disposable, ExtensionContext } from "vscode";
import { readHarnessSwitch } from "../settings";
import {
  ConnectedColumnsRequest,
  DbtLineageService,
} from "./dbtLineageService";

/** Test-only: answers the lineage panel's `getConnectedColumns` for the integration suites. */
export const CONNECTED_COLUMNS_COMMAND =
  "fusionPowerUser.test.getConnectedColumns";

/** Test-only: answers the lineage panel's `getColumns` for the integration suites. */
export const LINEAGE_COLUMNS_COMMAND = "fusionPowerUser.test.getLineageColumns";

export function registerConnectedColumnsCommand(
  context: ExtensionContext,
  service: DbtLineageService,
): void {
  if (readHarnessSwitch("integrationCommands") !== "1") {
    return;
  }
  context.subscriptions.push(
    commands.registerCommand(
      CONNECTED_COLUMNS_COMMAND,
      (request: ConnectedColumnsRequest) =>
        service.getConnectedColumns(request),
    ),
  );
}

/** Registers {@link LINEAGE_COLUMNS_COMMAND} when the integration harness asks for it. */
export function registerLineageColumnsCommand(
  getColumns: (params: { table: string; refresh: boolean }) => Promise<unknown>,
): Disposable | undefined {
  if (readHarnessSwitch("integrationCommands") !== "1") {
    return undefined;
  }
  return commands.registerCommand(LINEAGE_COLUMNS_COMMAND, (table: string) =>
    getColumns({ table, refresh: false }),
  );
}
