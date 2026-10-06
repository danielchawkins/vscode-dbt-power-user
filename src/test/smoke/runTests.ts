import { globSync } from "fs";
import Mocha from "mocha";
import * as path from "path";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    timeout: 120_000,
    color: true,
  });

  const testsRoot = path.resolve(__dirname);
  const files = globSync("**/*.test.js", { cwd: testsRoot }).sort();
  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
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
