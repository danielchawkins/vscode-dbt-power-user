import Mocha from "mocha";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Global fixtures for the integration labels, loaded through `.vscode-test.mjs`'s `mocha.require`. test-cli's serial
 * runner calls only `mochaGlobalSetup` and `mochaGlobalTeardown`, and the test globals do not exist yet at setup, so
 * setup listens on the runner instead. Each failed test appends its title, error and stack to `failures.jsonl`;
 * after the run, `shutdown.json` records the dirty documents and tabs still open as the host quits.
 */
const dir = process.env.FPU_INTEGRATION_DIAGNOSTICS_DIR;

function write(file: string, text: string, append = false): void {
  if (!dir) {
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  (append ? fs.appendFileSync : fs.writeFileSync)(path.join(dir, file), text);
}

export function mochaGlobalSetup(): void {
  const run = Mocha.Runner.prototype.run;
  Mocha.Runner.prototype.run = function (
    this: Mocha.Runner,
    ...args: Parameters<typeof run>
  ) {
    this.on("fail", (test, error) => {
      const record = {
        at: Date.now(),
        title: test.fullTitle(),
        file: test.file,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      write("failures.jsonl", JSON.stringify(record) + "\n", true);
    });
    return run.apply(this, args);
  };
}

export function mochaGlobalTeardown(): void {
  const state = {
    at: Date.now(),
    dirty: vscode.workspace.textDocuments
      .filter((document) => document.isDirty)
      .map((document) => document.uri.toString()),
    tabs: vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => ({ label: tab.label, dirty: tab.isDirty })),
    ),
  };
  write("shutdown.json", JSON.stringify(state, null, 2));
  console.log(`FPU_INTEGRATION_SHUTDOWN=${JSON.stringify(state)}`);
}
