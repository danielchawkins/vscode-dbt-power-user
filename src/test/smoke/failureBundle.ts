import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { currentFixtureName } from "./fixtureContext";
import {
  diagnosticsDirectory,
  takeProbes,
  testSlug,
  writeProbes,
} from "./probeLog";
import { captureWorkbenchScreenshot } from "./workbench";

/** The parts of a Mocha test and error a failure bundle records. */
interface FailedTest {
  fullTitle(): string;
  file?: string;
  duration?: number;
}

/**
 * Writes `<diagnostics>/failures/<fixture>/<test>/` for a failed test: the error and stack, every probe the test
 * recorded, the editor state, and a screenshot of the workbench at the moment of failure.
 */
export async function writeFailureBundle(
  test: FailedTest,
  error: unknown,
): Promise<void> {
  const root = diagnosticsDirectory();
  const probes = takeProbes();
  if (!root) {
    return;
  }
  const dir = path.join(
    root,
    "failures",
    currentFixtureName() ?? "unknown",
    testSlug(test.fullTitle()),
  );
  fs.mkdirSync(dir, { recursive: true });
  const failure = error instanceof Error ? error : new Error(String(error));
  fs.writeFileSync(
    path.join(dir, "error.json"),
    JSON.stringify(
      {
        title: test.fullTitle(),
        file: test.file,
        durationMs: test.duration,
        at: Date.now(),
        message: failure.message,
        stack: failure.stack,
        lastProbe: probes.at(-1),
        editors: editorState(),
      },
      null,
      2,
    ),
  );
  writeProbes(dir, probes);
  const port = process.env.FPU_CDP_PORT;
  const host = process.env.FPU_SMOKE_HOST;
  if (port && host) {
    try {
      fs.writeFileSync(
        path.join(dir, "workbench.png"),
        await captureWorkbenchScreenshot(port, host),
      );
    } catch (screenshotError) {
      fs.writeFileSync(
        path.join(dir, "workbench.png.error.txt"),
        String(screenshotError),
      );
    }
  }
  console.log(`FPU_SMOKE_FAILURE_BUNDLE=${dir}`);
}

/** Open tabs and dirty documents, which a leaked draft or a save prompt would show. */
function editorState() {
  return {
    dirty: vscode.workspace.textDocuments
      .filter((document) => document.isDirty)
      .map((document) => document.uri.toString()),
    tabs: vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => ({
        label: tab.label,
        dirty: tab.isDirty,
        active: tab.isActive,
      })),
    ),
  };
}
