import { queryResults } from "@fusion-power-user/webview-contract";
import type { Log } from "../../core/log";
import { getStringSizeInMb } from "../../core/text";

type QueryHistory = queryResults.QueryHistoryEntry;

/** The most recent entries kept. */
const MAX_ENTRIES = 10;
/** Past this size, the oldest entry is dropped before a new one is added. */
const MAX_SIZE_MB = 3;

/** What an entry records about the project that ran it. */
export interface HistoryProject {
  getAdapterType(): string;
  getProjectName(): string;
}

/** The query results of this session, newest first; kept in host memory only. */
export class QueryHistoryStore {
  private entries: QueryHistory[] = [];

  constructor(private readonly log: Pick<Log, "info">) {}

  all(): QueryHistory[] {
    return this.entries;
  }

  clear(): void {
    this.entries = [];
  }

  /** Records a result, dropping the oldest entry when the history outgrows its size budget. */
  add(
    project: HistoryProject,
    entry: Omit<QueryHistory, "timestamp" | "adapter" | "projectName">,
  ): void {
    if (getStringSizeInMb(JSON.stringify(this.entries)) > MAX_SIZE_MB) {
      this.entries.pop();
      this.log.info(
        "updateQueryHistory",
        `Query history size exceeded ${MAX_SIZE_MB}MB, cleared oldest entry`,
      );
    }
    this.entries.unshift({
      ...entry,
      timestamp: Date.now(),
      adapter: project.getAdapterType(),
      projectName: project.getProjectName(),
    });
    this.entries = this.entries.slice(0, MAX_ENTRIES);
  }
}
