import { lineage } from "@fusion-power-user/webview-contract";
import { panelRequests } from "@modules/app/requestExecutor";
import type { Direction } from "./graph";

type PanelMessage = lineage.PanelMessage;

const requests = panelRequests<PanelMessage>();
const { executeRequestInSync } = requests;
export const { executeRequestInAsync } = requests;

/** The `direction` neighbours of `table`, through `childTables` or `parentTables`. */
export const fetchNeighbours = async (
  direction: Direction,
  table: string,
): Promise<lineage.LineageTable[]> => {
  const body = (await executeRequestInSync(
    direction === "children" ? "childTables" : "parentTables",
    { args: { params: { table } } },
  )) as { tables?: lineage.LineageTable[] } | undefined;
  return body?.tables ?? [];
};

/** The `getColumns` body of `table`; `refresh` asks the warehouse for a source's columns. */
export const fetchTableColumns = async (
  table: string,
  refresh = false,
): Promise<lineage.TableColumns | undefined> =>
  (await executeRequestInSync("getColumns", {
    args: { params: { table, refresh } },
  })) as lineage.TableColumns | undefined;

export const fetchColumns = async (
  table: string,
): Promise<lineage.LineageColumn[]> =>
  (await fetchTableColumns(table))?.columns ?? [];

export const fetchConnected = async (
  params: lineage.ConnectedColumnsParams,
): Promise<lineage.ConnectedColumns> =>
  ((await executeRequestInSync("getConnectedColumns", {
    args: { params },
  })) as lineage.ConnectedColumns | undefined) ?? { column_lineage: [] };

export const fetchSettings = async (): Promise<lineage.LineageSettings> =>
  (await executeRequestInSync("getLineageSettings")) as lineage.LineageSettings;

export const persistSettings = (
  settings: Partial<lineage.LineageSettings>,
): Promise<unknown> =>
  executeRequestInSync("persistLineageSettings", {
    args: { params: settings },
  });

export const fetchRelationships = async (
  includeSources: boolean,
): Promise<lineage.LineageRef[]> =>
  (
    (await executeRequestInSync("getRelationships", {
      args: { params: { includeSources } },
    })) as { refs?: lineage.LineageRef[] } | undefined
  )?.refs ?? [];

export const fetchDetails = (
  command: "getExposureDetails" | "getFunctionDetails",
  name: string,
): Promise<unknown> =>
  executeRequestInSync(command, { args: { params: { name } } });

export const openFile = (url: string): void =>
  executeRequestInAsync("openFile", { args: { params: { url } } });
