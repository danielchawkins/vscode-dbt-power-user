import { runTests } from "@vscode/test-electron";
import { cpSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { fixturePath, getExtensionRoot } from "./helpers/testFixtures";

async function main() {
  const fixtureSource = fixturePath("single-project");
  const userDataDir = mkdtempSync(path.join(tmpdir(), "fpu-integration-user-"));
  const extensionsDir = mkdtempSync(
    path.join(tmpdir(), "fpu-integration-ext-"),
  );
  const workspaceParent = mkdtempSync(
    path.join(tmpdir(), "fpu-integration-workspace-"),
  );
  const workspaceDir = path.join(workspaceParent, path.basename(fixtureSource));
  cpSync(fixtureSource, workspaceDir, { recursive: true });
  const cleanup = () => {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(extensionsDir, { recursive: true, force: true });
    rmSync(workspaceParent, { recursive: true, force: true });
  };
  process.once("exit", cleanup);

  try {
    const extensionDevelopmentPath = getExtensionRoot();
    const extensionTestsPath = path.resolve(__dirname, "./index.js");

    await runTests({
      version: "1.128.0",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exitCode = 1;
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
}

main();
