import type { queryResults } from "@fusion-power-user/webview-contract";
import { QueryPanelTitleTabState } from "../components/QueryPanelContents/types";

export type TableData = Record<string, unknown>[];

export type QueryHistory = queryResults.QueryHistoryEntry;

/** The bottom panel's view type; results tabs and history runs use the others. */
export const DEFAULT_VIEW_TYPE = 0 satisfies queryResults.ViewType;

export interface QueryPanelStateProps {
  viewType: queryResults.ViewType;
  loading: boolean;
  queryResults?:
    | {
        data: TableData;
        columnNames: string[];
        columnTypes: (string | null)[];
        raw_sql: string;
        compiled_sql: string;
      }
    | undefined;
  queryExecutionInfo?: { elapsedTime: number } | undefined;
  queryResultsError?:
    | {
        message: string;
        code: number;
        data: string;
      }
    | undefined;
  compiledCodeMarkup?: string | undefined;
  hintIndex: number;
  limit?: number | undefined;
  perspectiveTheme: string;
  queryHistory: QueryHistory[];
  tabState: QueryPanelTitleTabState;
  activeEditor?:
    | {
        filepath: string;
        query: string;
      }
    | undefined;
  /** The Current Project's manifest publication, from the host's context. */
  publication?: string | undefined;
}
