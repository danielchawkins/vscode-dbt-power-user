import { glob } from "glob";
import Mocha from "mocha";
import * as path from "path";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    timeout: 30_000,
    color: true,
  });

  const testsRoot = path.resolve(__dirname);
  const files = await glob("**/*.test.js", { cwd: testsRoot });

  // The symlinked-workspace run reuses this same entry point but must only
  // execute symlinkedWorkspace.test.js; the other suites assume the realpath
  // workspace and would either fail or double-run pointlessly against it.
  const isSymlinkedRun = process.env.FPU_SYMLINKED_WORKSPACE === "1";
  const isNativeEditorRun = process.env.FPU_NATIVE_EDITOR_MODE !== undefined;
  const selectedFiles = isSymlinkedRun
    ? files.filter((file) => file.includes("symlinkedWorkspace.test.js"))
    : isNativeEditorRun
      ? files.filter((file) => file.includes("nativeEditorFeatures.test.js"))
      : files;

  for (const file of selectedFiles) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
