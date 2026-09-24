import { runTests } from "@vscode/test-electron";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
  configureProfilesThroughSetting(workspaceDir);
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
      ],
      extensionTestsEnv: conflictingProfilesEnv(workspaceParent),
    });

    // Second launch: open the fixture through a symlink instead of its real
    // path. Fusion canonicalizes --project-dir but not document URIs, so this
    // is the only way to exercise fusionLanguageClient's uriConverters, which
    // remap LSP responses between the symlinked root and the realpath.
    const symlinkPath = path.join(workspaceParent, "single-project-link");
    symlinkSync(workspaceDir, symlinkPath);
    try {
      await runTests({
        version: "1.128.0",
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [
          symlinkPath,
          `--user-data-dir=${userDataDir}`,
          `--extensions-dir=${extensionsDir}`,
          "--use-inmemory-secretstorage",
        ],
        extensionTestsEnv: {
          ...conflictingProfilesEnv(workspaceParent),
          FPU_SYMLINKED_WORKSPACE: "1",
        },
      });
    } finally {
      rmSync(symlinkPath, { force: true });
    }
  } catch (err) {
    console.error("Failed to run integration tests:", err);
    process.exitCode = 1;
  } finally {
    process.removeListener("exit", cleanup);
    cleanup();
  }
}

/**
 * `fusionPowerUser.profilesDir` is the documented override for a profiles directory the environment gets
 * wrong, so the fixture's profiles are reached only through it. The fixture keeps its profiles.yml at the
 * project root.
 */
function configureProfilesThroughSetting(dir: string): void {
  const vscodeDir = path.join(dir, ".vscode");
  mkdirSync(vscodeDir, { recursive: true });
  writeFileSync(
    path.join(vscodeDir, "settings.json"),
    JSON.stringify({ "fusionPowerUser.profilesDir": "${workspaceFolder}" }),
  );
}

/**
 * Names an empty profiles directory in both variables dbt reads, as a user's environment can. A developer's
 * login shell may substitute its own value; either way the environment points away from the fixture, so
 * only the setting can make dbt resolve the fixture profile.
 */
function conflictingProfilesEnv(parent: string): Record<string, string> {
  const decoy = path.join(parent, "decoy-profiles");
  mkdirSync(decoy, { recursive: true });
  return { DBT_PROFILES_DIR: decoy, DBT_ENGINE_PROFILES_DIR: decoy };
}

main();
