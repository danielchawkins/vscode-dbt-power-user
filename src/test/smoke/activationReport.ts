import { commands, Uri, workspace } from "vscode";
import type { StartupPhases } from "./startupPhases";
import { parseRawPerfMarks, startupPhasesSinceLaunch } from "./startupPhases";

const EXTENSION_ID = "danielchawkins.fusion-power-user";

export interface ActivationMetric {
  eager: boolean;
  loadCode: number;
  callActivate: number;
  finishActivate: number;
  event: string;
  by: string;
}

export interface StartupMetrics {
  activation: ActivationMetric;
  phases: StartupPhases;
}

export async function readActivationMetric(): Promise<ActivationMetric> {
  return (await readStartupMetrics()).activation;
}

/** Reads the activation row and the startup phases from one report text. */
export async function readStartupMetrics(): Promise<StartupMetrics> {
  const { text, activation } = await readStartupReport();
  return {
    activation,
    phases: startupPhasesSinceLaunch(
      parseRawPerfMarks(text),
      process.env.FPU_SMOKE_LAUNCH_EPOCH_MS,
    ),
  };
}

async function readStartupReport(): Promise<{
  text: string;
  activation: ActivationMetric;
}> {
  let lastRow: string | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (attempt % 10 === 0) {
      await commands.executeCommand("perfview.show");
    }
    const report = await workspace.openTextDocument(
      Uri.from({ scheme: "perf", path: "Startup Performance" }),
    );
    const text = report.getText();
    const row = text
      .split("\n")
      .find((line) => line.split("|")[1]?.trim() === EXTENSION_ID);
    if (row) {
      lastRow = row;
      const activation = parseActivationRow(row);
      if (activation) {
        return { text, activation };
      }
    }
    await sleep(100);
  }
  throw new Error(
    `Startup Performance did not report Fusion Power User; last row: ${lastRow ?? "none"}`,
  );
}

function parseActivationRow(row: string): ActivationMetric | undefined {
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
    result.finishActivate >= 0
  ) {
    return result;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
