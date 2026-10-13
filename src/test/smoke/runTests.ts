import { globSync } from "fs";
import Mocha from "mocha";
import * as path from "path";
import { extHostStartMs } from "./extHostStart";
import { selectSuites } from "./suiteSelection";

export async function run(): Promise<void> {
  // The first callback in the extension host: the launcher's runTests call has returned to this point.
  const startMs = extHostStartMs(
    process.env.FPU_SMOKE_LAUNCH_EPOCH_MS,
    Date.now(),
  );
  if (startMs !== undefined) {
    console.log(`FPU_SMOKE_EXTHOST_START_MS=${startMs}`);
  }
  const mocha = new Mocha({
    ui: "tdd",
    timeout: 120_000,
    color: true,
  });

  const testsRoot = path.resolve(__dirname);
  const files = globSync("**/*.test.js", { cwd: testsRoot }).sort();
  const suiteName = (file: string) =>
    path.basename(file).replace(/\.test\.js$/, "");
  const selected = selectSuites(
    files.map(suiteName),
    process.env.FPU_SMOKE_SUITES,
  );
  console.log(`FPU_SMOKE_SUITES_SELECTED=${JSON.stringify(selected)}`);
  for (const file of files) {
    if (selected.includes(suiteName(file))) {
      mocha.addFile(path.resolve(testsRoot, file));
    }
  }

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} smoke test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
