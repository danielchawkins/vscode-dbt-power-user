import type { lineage } from "@fusion-power-user/webview-contract";
import { panelRequests } from "@modules/app/requestExecutor";
import type { Direction } from "./graph";

type PanelMessage = lineage.PanelMessage;

const requests = panelRequests<PanelMessage, lineage.ResponseBodies>();
const { executeRequestInSync } = requests;
export const { executeRequestInAsync } = requests;

/** The `direction` neighbours of `table`, through `childTables` or `parentTables`. */
export const fetchNeighbours = async (
  direction: Direction,
  table: string,
): Promise<lineage.LineageTable[]> => {
  const body = await executeRequestInSync(
    direction === "children" ? "childTables" : "parentTables",
    { args: { params: { table } } },
  );
  return body.tables ?? [];
};

/** The data-flow `[parent, child]` pairs among `tables`. */
export const fetchEdges = async (
  tables: readonly string[],
): Promise<[string, string][]> => {
  const body = await executeRequestInSync("tableEdges", {
    args: { params: { tables: [...tables] } },
  });
  return body.edges ?? [];
};

/** Every table of the project graph, with the data-flow `[parent, child]` pairs among them. */
export const fetchProjectGraph = (): Promise<{
  tables: lineage.LineageTable[];
  edges: [string, string][];
}> => executeRequestInSync("getProjectGraph");

/** The host's Rust layout of the graph frame in `params`, or `superseded` when a newer generation overtook it. */
export const fetchLayout = (
  params: lineage.LayoutParams,
): Promise<lineage.LayoutBody> =>
  executeRequestInSync("layout", { args: { params } });

/** The `getColumns` body of `table`; `refresh` asks the warehouse for a source's columns. */
export const fetchTableColumns = (
  table: string,
  refresh = false,
): Promise<lineage.TableColumns | undefined> =>
  executeRequestInSync("getColumns", {
    args: { params: { table, refresh } },
  });

export const fetchColumns = async (
  table: string,
): Promise<lineage.LineageColumn[]> =>
  (await fetchTableColumns(table))?.columns ?? [];

export const fetchConnected = async (
  params: lineage.ConnectedColumnsParams,
): Promise<lineage.ConnectedColumns> =>
  (await executeRequestInSync("getConnectedColumns", {
    args: { params },
  })) ?? { column_lineage: [] };

export const fetchSettings = (): Promise<lineage.LineageSettings> =>
  executeRequestInSync("getLineageSettings");

/** The hidden cards of this workspace, as the host kept them. */
export const fetchHiddenCards = async (): Promise<lineage.HiddenCard[]> =>
  (await executeRequestInSync("getHiddenCards")).cards;

export const persistHiddenCards = (cards: lineage.HiddenCard[]): void => {
  executeRequestInAsync("persistHiddenCards", { args: { params: { cards } } });
};

/** The node types and tags the workspace has switched off, as the host kept them. */
export const fetchLineageScope = async (): Promise<lineage.LineageScope> =>
  (await executeRequestInSync("getLineageScope")).scope;

export const persistLineageScope = (scope: lineage.LineageScope): void => {
  executeRequestInAsync("persistLineageScope", { args: { params: { scope } } });
};

/** The Layout control's settings, as the host kept them for the workspace. */
export const fetchLineageLayout = async (): Promise<lineage.LineageLayout> =>
  (await executeRequestInSync("getLineageLayout")).layout;

export const persistLineageLayout = (layout: lineage.LineageLayout): void => {
  executeRequestInAsync("persistLineageLayout", {
    args: { params: { layout } },
  });
};

/** The `lineage.exclude` rules, each with the nodes it excludes or the failure dbt gave. */
export const fetchExclusions = async (): Promise<lineage.ExclusionRule[]> =>
  (await executeRequestInSync("getExclusions")).rules;

/** Adds `rule` to the exclusion setting; the host answers once the setting is written. */
export const addExclusion = (rule: string): Promise<unknown> =>
  executeRequestInSync("addExclusion", { args: { params: { rule } } });

/** Removes the exclusion setting's entry that is `rule`; the host answers once the setting is written. */
export const removeExclusion = (rule: string): Promise<unknown> =>
  executeRequestInSync("removeExclusion", { args: { params: { rule } } });

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
    await executeRequestInSync("getRelationships", {
      args: { params: { includeSources } },
    })
  ).refs ?? [];

export const fetchDetails = (
  command: "getExposureDetails" | "getFunctionDetails",
  name: string,
): Promise<unknown> =>
  executeRequestInSync(command, { args: { params: { name } } });

export const openFile = (url: string): void =>
  executeRequestInAsync("openFile", { args: { params: { url } } });
