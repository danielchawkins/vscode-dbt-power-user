import {
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createTimestampedLog,
  findAvailablePort,
  listLogs,
} from "./launchSupport.mjs";
import { resolveOnPath, TOOL_ENV_FIXTURES } from "./toolEnvFixtures.mjs";

const __dirname = import.meta.dirname;
const root = path.resolve(__dirname, "../..");
const SURVIVING_PROCESS_TIMEOUT_MS = 5_000;
const SURVIVING_PROCESS_POLL_MS = 250;
// Mocha's own timeout runs inside the extension host, so a blocked host never reports it.
const HOST_WATCHDOG_MS = Number(process.env.FPU_SMOKE_WATCHDOG_MS ?? 240_000);
// Directories every tool-environment host keeps on PATH: enough for the host's own shell tools, nothing else.
const SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

// A Cursor-launched shell sets this for its own CLI; inherited, it makes the pinned
// host run as a Node script against our launch args instead of opening a workbench.
delete process.env.ELECTRON_RUN_AS_NODE;
// The host inherits this environment; only --suites may select suites.
delete process.env.FPU_SMOKE_SUITES;

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, index, argv) => {
    if (!arg.startsWith("--")) {
      return [];
    }
    const key = arg.slice(2);
    return [[key, argv[index + 1]]];
  }),
);

const host = args.host ?? "vscode";
const vsix = args.vsix;
const fixture =
  args.fixture ?? path.join(root, "src/test/fixtures/single-project");
const hostApp = args["host-app"];
if (!hostApp || !vsix) {
  console.error("Missing --host-app or --vsix");
  process.exit(2);
}
// `--fixture tool-env-<name>` names a table entry, built fresh in a temporary directory.
const toolEnvFixture = TOOL_ENV_FIXTURES.find(
  (entry) => `tool-env-${entry.name}` === args.fixture,
);
if (args.fixture && !existsSync(args.fixture) && !toolEnvFixture) {
  console.error(`Unknown fixture ${args.fixture}`);
  process.exit(2);
}

if (process.env.FPU_SKIP_INTEGRATION_COMPILE !== "1") {
  const compile = spawnSync("npm", ["run", "compile:integration"], {
    cwd: root,
    stdio: "inherit",
  });
  if (compile.status !== 0) {
    process.exit(compile.status ?? 1);
  }
}

copyFileSync(
  path.join(root, "src/test/integration/out-package.json"),
  path.join(root, "out/package.json"),
);

const toolEnv = toolEnvFixture
  ? buildToolEnvironment(toolEnvFixture)
  : undefined;
const userDataDir = mkdtempSync(path.join(tmpdir(), `fpu-smoke-${host}-`));
const extensionsDir = mkdtempSync(
  path.join(tmpdir(), `fpu-smoke-ext-${host}-`),
);
const workspaceParent = mkdtempSync(
  path.join(tmpdir(), `fpu-smoke-workspace-${host}-`),
);
const workspaceDir =
  toolEnv?.workspace ?? path.join(workspaceParent, path.basename(fixture));
if (!toolEnv) {
  cpSync(fixture, workspaceDir, { recursive: true });
}
// A fixture with a .code-workspace file is opened as that workspace, so each folder's own settings apply.
const workspaceFile = readdirSync(workspaceDir).find((name) =>
  name.endsWith(".code-workspace"),
);
const openTarget = workspaceFile
  ? path.join(workspaceDir, workspaceFile)
  : workspaceDir;
if (!workspaceFile) {
  configureProfilesThroughSetting(workspaceDir);
}
const profilesEnv = conflictingProfilesEnv(workspaceParent);
const suites = toolEnv?.suites ?? args.suites;
// Logs, crash dumps, host output and failure bundles outlive the run: cleanup removes only the directories above.
const diagnosticsDir = path.resolve(
  process.env.FPU_SMOKE_DIAGNOSTICS ?? path.join(root, "out/smoke-diagnostics"),
  host,
  toolEnv ? `tool-env-${toolEnvFixture.name}` : path.basename(fixture),
);
rmSync(diagnosticsDir, { recursive: true, force: true });
mkdirSync(diagnosticsDir, { recursive: true });
const hostLog = createTimestampedLog(path.join(diagnosticsDir, "host.log"));
console.log(`FPU_SMOKE_DIAGNOSTICS_DIR=${diagnosticsDir}`);
const cleanup = () => {
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(extensionsDir, { recursive: true, force: true });
  rmSync(workspaceParent, { recursive: true, force: true });
  if (toolEnv) {
    rmSync(toolEnv.tmp, { recursive: true, force: true });
  }
};
process.once("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    cleanup();
    process.exit(
      128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1),
    );
  });
}

const cdpPort =
  process.env.FPU_CDP_PORT ??
  String(await findAvailablePort(10_000 + (process.pid % 20_000)));

// test-electron assumes Linux ships bin/code; Cursor's launcher is bin/cursor, beside the executable's name.
const [cliPath, ...cliArgs] =
  process.platform === "linux"
    ? [path.join(path.dirname(hostApp), "bin", path.basename(hostApp))]
    : resolveCliArgsFromVSCodeExecutablePath(hostApp, {
        reuseMachineInstall: true,
      });
const install = spawnSync(
  cliPath,
  [
    ...cliArgs,
    "--user-data-dir",
    userDataDir,
    "--install-extension",
    vsix,
    "--extensions-dir",
    extensionsDir,
    "--force",
  ],
  { stdio: "inherit", encoding: "utf-8" },
);
if (install.error) {
  console.error(`Could not run ${cliPath}: ${install.error.message}`);
}
if (install.status !== 0) {
  process.exit(install.status ?? 1);
}

const watchdog = setTimeout(() => {
  // Synchronous writes: process.exit discards pending async output on a piped stderr.
  const out = (text) => writeSync(2, `${text}\n`);
  out(
    `FPU_SMOKE_WATCHDOG: ${host} did not finish within ${HOST_WATCHDOG_MS} ms`,
  );
  const ps = spawnSync("ps", ["-eo", "pid,ppid,pcpu,etime,command"], {
    encoding: "utf-8",
  });
  // On Linux the host lives in its install directory (e.g. .../usr/share/cursor), not a .app bundle.
  const bundle =
    process.platform === "linux"
      ? path.dirname(hostApp)
      : hostApp.slice(0, hostApp.indexOf(".app") + 4);
  const hostLines = ps.stdout
    .split("\n")
    .filter((line) =>
      process.platform === "linux"
        ? line.includes(bundle)
        : /Cursor|Code|dbt|Electron/.test(line),
    );
  out(hostLines.join("\n"));
  const logs = listLogs(path.join(diagnosticsDir, "logs")).sort(
    (a, b) =>
      Number(/renderer|exthost\.log|Fusion|dbt/i.test(b)) -
      Number(/renderer|exthost\.log|Fusion|dbt/i.test(a)),
  );
  for (const file of logs) {
    const lines = readFileSync(file, "utf-8").split("\n");
    out(`FPU_SMOKE_LOG ${path.relative(diagnosticsDir, file)}`);
    out(lines.slice(-80).join("\n"));
  }
  // The busiest processes of the host under test are the likeliest to be spinning; native stacks name the
  // loop. Helper processes retitle themselves, so match the bundle path or a helper title.
  const busiest = hostLines
    .filter((line) =>
      line.includes(bundle) ? true : /(Cursor|Code) Helper/.test(line),
    )
    .map((line) => line.trim().split(/\s+/))
    .sort((a, b) => Number(b[2]) - Number(a[2]))
    .slice(0, 2);
  for (const [pid, , cpu] of process.platform === "darwin" ? busiest : []) {
    const sample = spawnSync("sample", [pid, "3"], { encoding: "utf-8" });
    out(`FPU_SMOKE_SAMPLE pid=${pid} cpu=${cpu}`);
    out(
      ([sample.stdout, sample.stderr].find(Boolean) ?? sample.stderr)
        .split("\n")
        .slice(0, 150)
        .join("\n"),
    );
  }
  cleanup();
  process.exit(124);
}, HOST_WATCHDOG_MS);
watchdog.unref();

try {
  const launchEpochMs = Date.now();
  const passedMarker = path.join(workspaceParent, "fpu-smoke-passed");
  await runTests({
    vscodeExecutablePath: hostApp,
    extensionTestsPath: path.join(root, "out/test/smoke/index.js"),
    stdout: hostLog.tee(process.stdout),
    stderr: hostLog.tee(process.stderr),
    launchArgs: [
      openTarget,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      `--remote-debugging-port=${cdpPort}`,
      `--logsPath=${path.join(diagnosticsDir, "logs")}`,
      `--crash-reporter-directory=${path.join(diagnosticsDir, "crashes")}`,
      // Trace for this extension only; the workbench's own trace would bury it.
      "--log=danielchawkins.fusion-power-user:trace",
      // A covered or unfocused window otherwise reports hidden and paints nothing until it is raised.
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      // Secrets go to a plain file and a mock keychain; a throwaway home otherwise makes macOS offer to create one.
      "--password-store=basic",
      "--use-mock-keychain",
      // The host otherwise merges the login shell's environment over this one, putting its PATH ahead of the decoy.
      ...(toolEnv ? ["--force-disable-user-env"] : []),
      ...(host === "cursor"
        ? ["--skip-onboarding", "--suppress-popups-on-startup"]
        : []),
    ],
    extensionTestsEnv: {
      ...profilesEnv,
      ...(toolEnv ? toolEnv.env : {}),
      ...(toolEnv
        ? {
            FPU_SMOKE_LOGS_DIR: path.join(diagnosticsDir, "logs"),
            FPU_SMOKE_TOOLENV_TMP: toolEnv.tmp,
          }
        : {}),
      FPU_SMOKE_HOST: host,
      FPU_CDP_PORT: cdpPort,
      FPU_SMOKE_DIAGNOSTICS: diagnosticsDir,
      FPU_SMOKE_LAUNCH_EPOCH_MS: String(launchEpochMs),
      FPU_SMOKE_PASSED_MARKER: passedMarker,
      ...(suites ? { FPU_SMOKE_SUITES: suites } : {}),
      ...(process.env.FPU_RUNTIME_BENCHMARK
        ? { FPU_RUNTIME_BENCHMARK: process.env.FPU_RUNTIME_BENCHMARK }
        : {}),
      ...(process.env.FPU_SMOKE_REQUIRE_FUSION
        ? { FPU_SMOKE_REQUIRE_FUSION: process.env.FPU_SMOKE_REQUIRE_FUSION }
        : {}),
      ...(process.env.FPU_SMOKE_SCREENSHOTS
        ? {
            FPU_SMOKE_SCREENSHOTS: path.resolve(
              process.env.FPU_SMOKE_SCREENSHOTS,
            ),
          }
        : {}),
    },
  }).catch((error) => {
    // Cursor can abort in its own native code while quitting, after the tests returned. The marker is written only
    // when every test passed, so a crash after it is the host's, and any other failure still fails the run.
    if (error?.signal && existsSync(passedMarker)) {
      console.warn(
        `FPU_SMOKE_HOST_EXIT_SIGNAL=${error.signal}: the tests passed; the ${host} host crashed while quitting`,
      );
      return;
    }
    throw error;
  });
  // Cursor on Linux can exit 0 after a failed run, so a clean exit without the marker is still a failure.
  if (!existsSync(passedMarker)) {
    throw new Error(
      `${host} exited cleanly but its tests did not all pass (no ${passedMarker})`,
    );
  }
  await assertNoSurvivingFusionLspProcess(workspaceDir);
} finally {
  clearTimeout(watchdog);
  process.removeListener("exit", cleanup);
  cleanup();
}

// A process still naming the disposable workspaceDir after this deadline leaked past host exit.
async function assertNoSurvivingFusionLspProcess(scopedWorkspaceDir) {
  const deadline = Date.now() + SURVIVING_PROCESS_TIMEOUT_MS;
  let leaked = [];
  do {
    const ps = spawnSync("ps", ["-eo", "pid,command"], { encoding: "utf-8" });
    leaked = ps.stdout
      .split("\n")
      .filter(
        (line) => line.includes("lsp") && line.includes(scopedWorkspaceDir),
      );
    if (leaked.length === 0) {
      return;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SURVIVING_PROCESS_POLL_MS),
    );
  } while (Date.now() < deadline);
  throw new Error(
    `Surviving dbt lsp process after host exit:\n${leaked.join("\n")}`,
  );
}

/**
 * `fusionPowerUser.profilesDir` is the documented override for a profiles directory the environment gets
 * wrong, so a single-folder fixture's profiles.yml at its root is reached only through it. A value the fixture
 * already sets is kept; workspace fixtures carry their own per-folder settings.
 */
function configureProfilesThroughSetting(dir) {
  const settingsFile = path.join(dir, ".vscode", "settings.json");
  const settings = existsSync(settingsFile)
    ? JSON.parse(readFileSync(settingsFile, "utf-8"))
    : {};
  settings["fusionPowerUser.profilesDir"] ??= "${workspaceFolder}";
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

/**
 * Names an empty profiles directory in both variables dbt reads, as a user's environment can. A developer's
 * login shell may substitute its own value; either way the environment points away from the fixture, so
 * only the setting can make dbt resolve the fixture profile.
 */
function conflictingProfilesEnv(parent) {
  const decoy = path.join(parent, "decoy-profiles");
  mkdirSync(decoy, { recursive: true });
  return { DBT_PROFILES_DIR: decoy, DBT_ENGINE_PROFILES_DIR: decoy };
}

/**
 * Builds a tool-environment fixture in a fresh temporary directory. The host gets a PATH whose first entry is a
 * decoy `dbt` reporting 2.0.5, so only a tool-environment resolution can reach the pinned Fusion, which is found
 * on the original PATH and handed over as FPU_SMOKE_FUSION. Tool lookup is never done through mise.
 */
function buildToolEnvironment(entry) {
  const pinnedFusion = resolveOnPath("dbt", process.env.PATH);
  if (!pinnedFusion) {
    console.error("A tool-environment fixture needs dbt on PATH to pin");
    process.exit(1);
  }
  const tmp = mkdtempSync(
    path.join(tmpdir(), `fpu-smoke-tool-env-${entry.name}-`),
  );
  const decoyBin = path.join(tmp, "decoy-bin");
  mkdirSync(decoyBin);
  writeFileSync(path.join(decoyBin, "dbt"), "#!/bin/sh\necho 'dbt 2.0.5'\n");
  chmodSync(path.join(decoyBin, "dbt"), 0o755);
  const hostDirs = [...SYSTEM_PATH];
  // Each fixture reaches only the tool managers it needs through a shim directory, so no other host tool, such as
  // the pinned dbt beside mise in ~/.local/bin, is on its PATH.
  const tools = { none: [], direnv: ["direnv"] }[entry.name] ?? [
    "mise",
    "direnv",
  ];
  if (tools.length > 0) {
    const shim = path.join(tmp, "tool-shim");
    mkdirSync(shim);
    for (const tool of tools) {
      const found = resolveOnPath(tool, process.env.PATH);
      if (!found) {
        console.error(`The ${entry.name} fixture needs ${tool} on PATH`);
        process.exit(1);
      }
      symlinkSync(found, path.join(shim, tool));
    }
    hostDirs.unshift(shim);
  }
  const hostPath = hostDirs.join(path.delimiter);
  // The mise-free fixtures check that mise, and for none also direnv, really are off PATH.
  const absent =
    { none: ["mise", "direnv"], direnv: ["mise"] }[entry.name] ?? [];
  for (const tool of absent) {
    const found = resolveOnPath(tool, hostPath);
    if (found) {
      console.error(
        `${tool} is at ${found}; the ${entry.name} fixture needs it absent`,
      );
      process.exit(1);
    }
  }
  const built = entry.build(tmp);
  // Isolates mise and XDG state from the developer's machine; a fixture's own env wins over these.
  const isolation = {
    MISE_TRUSTED_CONFIG_PATHS: path.join(tmp, "no-trust"),
    MISE_DATA_DIR: path.join(tmp, "mise-data"),
    MISE_CONFIG_DIR: path.join(tmp, "mise-config"),
    MISE_GLOBAL_CONFIG_FILE: path.join(tmp, "mise-global.toml"),
    // The smoke image sets MISE_YES=1, which makes mise trust every config, so an untrusted fixture would pass.
    MISE_YES: "0",
    // mise trusts every config when it detects CI, and even an empty value counts; spawn drops undefined keys.
    CI: undefined,
    CONTINUOUS_INTEGRATION: undefined,
    BUILD_NUMBER: undefined,
    RUN_ID: undefined,
    GITHUB_ACTIONS: undefined,
    XDG_DATA_HOME: path.join(tmp, "xdg-data"),
    XDG_CONFIG_HOME: path.join(tmp, "xdg-config"),
  };
  const resultName = `tool-env-${entry.name}`;
  const resultsRoot = process.env.FPU_SMOKE_SCREENSHOTS
    ? path.resolve(process.env.FPU_SMOKE_SCREENSHOTS)
    : path.join(root, "out/smoke-results");
  return {
    tmp,
    workspace: built.workspace,
    suites: entry.suites.join(","),
    env: {
      ...isolation,
      ...built.env,
      PATH: [decoyBin, hostPath].join(path.delimiter),
      FPU_SMOKE_FUSION: pinnedFusion,
      FPU_SMOKE_REQUIRE_FUSION: "1",
      FPU_SMOKE_RESULTS: path.join(resultsRoot, host, resultName),
    },
  };
}
