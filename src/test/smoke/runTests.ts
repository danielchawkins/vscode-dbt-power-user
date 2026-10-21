import Mocha from "mocha";
import { globSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { extHostStartMs } from "./extHostStart";
import { writeFailureBundle } from "./failureBundle";
import { takeProbes } from "./probeLog";
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
    const bundles: Promise<void>[] = [];
    const runner = mocha.run((failures) => {
      void Promise.allSettled(bundles).then(() => {
        if (failures > 0) {
          reject(new Error(`${failures} smoke test(s) failed.`));
        } else {
          // The launcher reads this to tell a host that crashed while quitting from one whose tests failed.
          const marker = process.env.FPU_SMOKE_PASSED_MARKER;
          if (marker) {
            writeFileSync(marker, "passed\n");
          }
          resolve();
        }
      });
    });
    runner.on("fail", (test, error) => {
      console.error(
        `FPU_SMOKE_FAIL ${test.fullTitle()}\n${(error as Error)?.stack ?? String(error)}`,
      );
      bundles.push(writeFailureBundle(test, error));
    });
    // Probes from a passing test are not evidence for the next one.
    runner.on("test end", () => void takeProbes());
  });
}
