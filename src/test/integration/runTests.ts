import { runTests } from "@vscode/test-electron";
import { spawnSync } from "child_process";
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
  const prepareWorkspace = (name: string) => {
    const dir = path.join(workspaceParent, name);
    cpSync(fixtureSource, dir, { recursive: true });
    configureProfilesThroughSetting(dir);
    const modelsDir = path.join(dir, "models");
    rmSync(path.join(modelsDir, "broken_ref.sql"), { force: true });
    writeFileSync(path.join(modelsDir, "base.sql"), "select 1 as id\n");
    writeFileSync(
      path.join(modelsDir, "child.sql"),
      'select * from {{ ref("base") }}\n',
    );
    return dir;
  };
  const workspaceDir = prepareWorkspace(path.basename(fixtureSource));
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

    // Second launch opens a fresh copy through a symlink, proving the client works when the opened root is
    // not the realpath Fusion canonicalizes --project-dir to. A fresh copy and user-data dir keep the first
    // launch's editor state and LSP cache out of it.
    const linkedDir = prepareWorkspace("single-project-real");
    const linkedUserDataDir = mkdtempSync(
      path.join(temporaryRoot, "fpu-integration-user-"),
    );
    cpSync(userDir, path.join(linkedUserDataDir, "User"), { recursive: true });
    const symlinkPath = path.join(workspaceParent, "single-project-link");
    symlinkSync(linkedDir, symlinkPath);
    try {
      await runTests({
        version: "1.128.0",
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [
          symlinkPath,
          `--user-data-dir=${linkedUserDataDir}`,
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
      rmSync(linkedUserDataDir, { recursive: true, force: true });
    }
    if (process.env.FPU_RUN_NATIVE_EDITOR_EVIDENCE === "1") {
      for (const mode of ["strict", "baseline"]) {
        await runNativeEditorLaunch({
          mode,
          workspaceParent,
          userDir,
          temporaryRoot,
          extensionsDir,
          extensionDevelopmentPath,
          extensionTestsPath,
        });
      }
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
 * Opens a fresh copy of the native-editor fixture with one static-analysis mode, so that mode's Fusion Client
 * starts with it. The sources are created with `setup_raw` before launch, and the schema-origin hook is set in
 * the host environment, which the extension passes to `dbt lsp`.
 */
async function runNativeEditorLaunch(input: {
  mode: string;
  workspaceParent: string;
  userDir: string;
  temporaryRoot: string;
  extensionsDir: string;
  extensionDevelopmentPath: string;
  extensionTestsPath: string;
}): Promise<void> {
  const dir = path.join(input.workspaceParent, `native-editor-${input.mode}`);
  cpSync(fixturePath("native-editor"), dir, { recursive: true });
  writeFileSync(
    path.join(dir, ".vscode", "settings.json"),
    JSON.stringify({
      "fusionPowerUser.staticAnalysis": input.mode,
      "fusionPowerUser.profilesDir": "${workspaceFolder}",
      "fusionPowerUser.lint.enabled": false,
    }),
  );
  const setupArgs = ["run-operation", "setup_raw", "--profiles-dir", dir];
  const setup = spawnSync("dbt", setupArgs, {
    cwd: dir,
    encoding: "utf-8",
    timeout: 120_000,
  });
  writeFileSync(
    path.join(dir, ".native-editor-setup.json"),
    JSON.stringify({
      command: `dbt ${setupArgs.join(" ")}`,
      cwd: dir,
      exitCode: setup.status,
      error: setup.error?.message,
      outputTail: `${setup.stdout ?? ""}\n${setup.stderr ?? ""}`
        .trim()
        .slice(-600),
    }),
  );
  const userDataDir = mkdtempSync(
    path.join(input.temporaryRoot, "fpu-integration-user-"),
  );
  cpSync(input.userDir, path.join(userDataDir, "User"), { recursive: true });
  try {
    await runTests({
      version: "1.128.0",
      extensionDevelopmentPath: input.extensionDevelopmentPath,
      extensionTestsPath: input.extensionTestsPath,
      launchArgs: [
        dir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${input.extensionsDir}`,
        "--use-inmemory-secretstorage",
      ],
      extensionTestsEnv: {
        ...conflictingProfilesEnv(input.workspaceParent),
        FPU_NATIVE_EDITOR_MODE: input.mode,
        FUSION_POWER_USER_SCHEMA_ORIGIN: "local",
      },
    });
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
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
