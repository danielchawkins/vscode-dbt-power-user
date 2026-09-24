import { QueryPanelTitleTabState } from "../components/QueryPanelContents/types";

export type TableData = Record<string, unknown>[];

export interface QueryHistory {
  rawSql: string;
  compiledSql: string;
  timestamp: number;
  duration: number;
  adapter: string;
  projectName: string;
  modelName: string;
  data?: TableData;
}

export enum QueryPanelViewType {
  DEFAULT,
  OPEN_RESULTS_IN_TAB,
  OPEN_RESULTS_FROM_HISTORY_BOOKMARKS,
}

export interface QueryPanelStateProps {
  viewType: QueryPanelViewType;
  loading: boolean;
  queryResults?: {
    data: TableData;
    columnNames: string[];
    columnTypes: (string | null)[];
    raw_sql: string;
    compiled_sql: string;
  };
  queryExecutionInfo?: { elapsedTime: number };
  queryResultsError?: {
    message: string;
    code: number;
    data: string;
  };
  compiledCodeMarkup?: string;
  hintIndex: number;
  limit?: number;
  perspectiveTheme: string;
  queryHistory: QueryHistory[];
  tabState: QueryPanelTitleTabState;
  activeEditor?: {
    filepath: string;
    query: string;
  };
}
