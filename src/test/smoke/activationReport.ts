import { commands, Uri, workspace } from "vscode";
import { pollUntil } from "../async";
import { EXTENSION_ID } from "./panels";

export interface ActivationMetric {
  eager: boolean;
  loadCode: number;
  callActivate: number;
  finishActivate: number;
  event: string;
  by: string;
}

export async function readActivationMetric(): Promise<ActivationMetric> {
  let lastRow = "";
  let reads = 0;
  const row = await pollUntil(
    async () => {
      if (reads % 10 === 0) {
        await commands.executeCommand("perfview.show");
      }
      reads += 1;
      const report = await workspace.openTextDocument(
        Uri.from({ scheme: "perf", path: "Startup Performance" }),
      );
      lastRow =
        report
          .getText()
          .split("\n")
          .find((line) => line.split("|")[1]?.trim() === EXTENSION_ID) ??
        lastRow;
      return lastRow;
    },
    (found) => found !== "" && isReported(parseRow(found)),
    {
      timeoutMs: 20_000,
      intervalMs: 100,
      describe: (last) =>
        `Startup Performance to report Fusion Power User; last row: ${last || "none"}`,
    },
  );
  return parseRow(row);
}

function parseRow(row: string): ActivationMetric {
  const cells = row
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  return {
    eager: cells[1] === "true",
    loadCode: Number(cells[2]),
    callActivate: Number(cells[3]),
    finishActivate: Number(cells[4]),
    event: cells[5],
    by: cells[6],
  };
}

function isReported(metric: ActivationMetric): boolean {
  return (
    [metric.loadCode, metric.callActivate, metric.finishActivate].every(
      Number.isFinite,
    ) && metric.finishActivate >= 0
  );
}
