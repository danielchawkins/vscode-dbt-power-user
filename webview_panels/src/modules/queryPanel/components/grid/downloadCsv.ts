import { panelLogger } from "@modules/logger";
import { TableData } from "@modules/queryPanel/context/types";
import { executeRequestInAsync } from "@modules/queryPanel/requests";
import { dataToCsv } from "./csv";

/** Saves the result as a timestamped CSV file; a failure is logged and reported to the host. */
export function downloadAsCsv(columnNames: string[], rows: TableData): void {
  try {
    const url = window.URL.createObjectURL(
      new Blob([dataToCsv(columnNames, rows)], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `power_user_data_${new Date().toISOString()}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    panelLogger.error("Failed to download CSV:", error);
    executeRequestInAsync("error", {
      text: "Unable to download data as CSV. " + (error as Error).message,
    });
  }
}
