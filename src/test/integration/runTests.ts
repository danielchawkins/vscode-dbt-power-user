import { runTests } from "@vscode/test-electron";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { fixturePath, getExtensionRoot } from "./helpers/testFixtures";

async function main() {
  const fixtureSource = fixturePath("single-project");
  const temporaryRoot = realpathSync(tmpdir());
  const userDataDir = mkdtempSync(
    path.join(temporaryRoot, "fpu-integration-user-"),
  );
  const extensionsDir = mkdtempSync(
    path.join(temporaryRoot, "fpu-integration-ext-"),
  );
  const workspaceParent = mkdtempSync(
    path.join(temporaryRoot, "fpu-integration-workspace-"),
  );
  const workspaceDir = path.join(workspaceParent, path.basename(fixtureSource));
  cpSync(fixtureSource, workspaceDir, { recursive: true });
  const modelsDir = path.join(workspaceDir, "models");
  rmSync(path.join(modelsDir, "broken_ref.sql"), { force: true });
  writeFileSync(path.join(modelsDir, "base.sql"), "select 1 as id\n");
  writeFileSync(
    path.join(modelsDir, "child.sql"),
    'select * from {{ ref("base") }}\n',
  );
  const fusionPath = process.env.FPU_INTEGRATION_DBT_PATH;
  if (fusionPath) {
    if (!path.isAbsolute(fusionPath)) {
      throw new Error("FPU_INTEGRATION_DBT_PATH must be absolute");
    }
    const userDir = path.join(userDataDir, "User");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(
      path.join(userDir, "settings.json"),
      JSON.stringify({ "fusionPowerUser.dbtPath": fusionPath }),
    );
  }
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
        "--use-inmemory-secretstorage",
      ],
      extensionTestsEnv: {
        DBT_PROFILES_DIR: workspaceDir,
      },
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
