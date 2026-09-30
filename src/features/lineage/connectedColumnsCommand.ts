import { commands, Disposable } from "vscode";
import { readHarnessSwitch } from "../../settings";
import {
  ConnectedColumnsRequest,
  DbtLineageService,
} from "./dbtLineageService";

/** Test-only: answers the lineage panel's `getConnectedColumns` for the integration suites. */
export const CONNECTED_COLUMNS_COMMAND =
  "fusionPowerUser.test.getConnectedColumns";

/** Test-only: answers the lineage panel's `getColumns` for the integration suites. */
export const LINEAGE_COLUMNS_COMMAND = "fusionPowerUser.test.getLineageColumns";

/** Test-only: answers the lineage service's `getParentTables` for the integration suites. */
export const PARENT_TABLES_COMMAND = "fusionPowerUser.test.getParentTables";

/** Registers the connected-columns and parent-tables commands when the integration harness asks for them. */
export function registerConnectedColumnsCommand(
  service: DbtLineageService,
): Disposable | undefined {
  if (readHarnessSwitch("integrationCommands") !== "1") {
    return undefined;
  }
  return Disposable.from(
    commands.registerCommand(
      CONNECTED_COLUMNS_COMMAND,
      (request: ConnectedColumnsRequest) =>
        service.getConnectedColumns(request),
    ),
    commands.registerCommand(PARENT_TABLES_COMMAND, (table: string) =>
      service.getParentTables({ table }),
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
