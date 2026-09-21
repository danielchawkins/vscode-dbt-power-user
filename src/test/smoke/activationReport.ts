import { commands, Uri, workspace } from "vscode";

const EXTENSION_ID = "danielchawkins.fusion-power-user";

export interface ActivationMetric {
  eager: boolean;
  loadCode: number;
  callActivate: number;
  finishActivate: number;
  event: string;
  by: string;
}

export async function readActivationMetric(): Promise<ActivationMetric> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (attempt % 10 === 0) {
      await commands.executeCommand("perfview.show");
    }
    const report = await workspace.openTextDocument(
      Uri.from({ scheme: "perf", path: "Startup Performance" }),
    );
    const row = report
      .getText()
      .split("\n")
      .find((line) => line.split("|")[1]?.trim() === EXTENSION_ID);
    if (row) {
      const cells = row
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const result = {
        eager: cells[1] === "true",
        loadCode: Number(cells[2]),
        callActivate: Number(cells[3]),
        finishActivate: Number(cells[4]),
        event: cells[5],
        by: cells[6],
      };
      if (
        [result.loadCode, result.callActivate, result.finishActivate].every(
          Number.isFinite,
        ) &&
        result.finishActivate > 0
      ) {
        return result;
      }
    }
    await sleep(100);
  }
  throw new Error("Startup Performance did not report Fusion Power User");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
