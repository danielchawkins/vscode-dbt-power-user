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

// A Cursor-launched shell sets this for its own CLI; inherited, it makes the pinned
// host run as a Node script against our launch args instead of opening a workbench.
delete process.env.ELECTRON_RUN_AS_NODE;

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
  if (fusionPath && !path.isAbsolute(fusionPath)) {
    throw new Error("FPU_INTEGRATION_DBT_PATH must be absolute");
  }
  const userDir = path.join(userDataDir, "User");
  mkdirSync(userDir, { recursive: true });
  const userSettings: Record<string, string> = {};
  if (fusionPath) {
    userSettings["fusionPowerUser.dbtPath"] = fusionPath;
  }
  writeFileSync(
    path.join(userDir, "settings.json"),
    JSON.stringify(userSettings),
  );
  const cleanup = () => {
    // The fixture copy holds the only record of how dbt resolved its profile
    // and what it wrote, so keep it when a failure needs that evidence.
    if (process.env.FPU_KEEP_WORKSPACE) {
      console.log(`FPU_KEEP_WORKSPACE: preserved ${workspaceDir}`);
      return;
    }
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(extensionsDir, { recursive: true, force: true });
    rmSync(workspaceParent, { recursive: true, force: true });
  };
  process.once("exit", cleanup);

  try {
    const extensionDevelopmentPath = getExtensionRoot();
    const extensionTestsPath = path.resolve(__dirname, "./index.js");

    // Only reaches the child through this process's environment.
    delete process.env.ELECTRON_RUN_AS_NODE;

    await runTests({
      version: "1.128.0",
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspaceDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        "--use-inmemory-secretstorage",
        // Without this, VS Code resolves the host's environment by running the
        // developer's login shell, which re-exports whatever ~/.zprofile sets
        // and silently overwrites the profiles directories below.
        "--force-disable-user-env",
      ],
      // dbt reads profiles.yml from these before falling back to the working
      // directory and then the home directory, so pointing them at the fixture
      // makes the project resolvable on any machine. The extension passes no
      // profiles flag, leaving dbt's own cascade to find the fixture's file.
      extensionTestsEnv: {
        DBT_PROFILES_DIR: workspaceDir,
        DBT_ENGINE_PROFILES_DIR: workspaceDir,
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
