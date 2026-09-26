import {
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";
import { spawnSync } from "child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "fs";
import { createServer } from "net";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const SURVIVING_PROCESS_TIMEOUT_MS = 5_000;
const SURVIVING_PROCESS_POLL_MS = 250;
// Mocha's own timeout runs inside the extension host, so a blocked host never reports it.
const HOST_WATCHDOG_MS = Number(process.env.FPU_SMOKE_WATCHDOG_MS ?? 240_000);

// A Cursor-launched shell sets this for its own CLI; inherited, it makes the pinned
// host run as a Node script against our launch args instead of opening a workbench.
delete process.env.ELECTRON_RUN_AS_NODE;

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

const userDataDir = mkdtempSync(path.join(tmpdir(), `fpu-smoke-${host}-`));
const extensionsDir = mkdtempSync(
  path.join(tmpdir(), `fpu-smoke-ext-${host}-`),
);
const workspaceParent = mkdtempSync(
  path.join(tmpdir(), `fpu-smoke-workspace-${host}-`),
);
const workspaceDir = path.join(workspaceParent, path.basename(fixture));
cpSync(fixture, workspaceDir, { recursive: true });
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
const cleanup = () => {
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(extensionsDir, { recursive: true, force: true });
  rmSync(workspaceParent, { recursive: true, force: true });
};
process.once("exit", cleanup);

const cdpPort =
  process.env.FPU_CDP_PORT ??
  String(await findAvailablePort(10_000 + (process.pid % 20_000)));

const [cliPath, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(hostApp, {
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
  const hostLines = ps.stdout
    .split("\n")
    .filter((line) => /Cursor|Code|dbt|Electron/.test(line));
  out(hostLines.join("\n"));
  const logs = listLogs(path.join(userDataDir, "logs")).sort(
    (a, b) =>
      Number(/renderer|exthost\.log|Fusion|dbt/i.test(b)) -
      Number(/renderer|exthost\.log|Fusion|dbt/i.test(a)),
  );
  for (const file of logs) {
    const lines = readFileSync(file, "utf-8").split("\n");
    out(`FPU_SMOKE_LOG ${path.relative(userDataDir, file)}`);
    out(lines.slice(-80).join("\n"));
  }
  // The busiest processes of the host under test are the likeliest to be spinning; native stacks name the
  // loop. Helper processes retitle themselves, so match the bundle path or a helper title.
  const bundle = hostApp.slice(0, hostApp.indexOf(".app") + 4);
  const busiest = hostLines
    .filter(
      (line) => line.includes(bundle) || /(Cursor|Code) Helper/.test(line),
    )
    .map((line) => line.trim().split(/\s+/))
    .sort((a, b) => Number(b[2]) - Number(a[2]))
    .slice(0, 2);
  for (const [pid, , cpu] of process.platform === "darwin" ? busiest : []) {
    const sample = spawnSync("sample", [pid, "3"], { encoding: "utf-8" });
    out(`FPU_SMOKE_SAMPLE pid=${pid} cpu=${cpu}`);
    out((sample.stdout || sample.stderr).split("\n").slice(0, 150).join("\n"));
  }
  cleanup();
  process.exit(124);
}, HOST_WATCHDOG_MS);
watchdog.unref();

try {
  await runTests({
    vscodeExecutablePath: hostApp,
    extensionTestsPath: path.join(root, "out/test/smoke/index.js"),
    launchArgs: [
      openTarget,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      `--remote-debugging-port=${cdpPort}`,
      ...(host === "cursor"
        ? ["--skip-onboarding", "--suppress-popups-on-startup"]
        : []),
    ],
    extensionTestsEnv: {
      ...profilesEnv,
      FPU_SMOKE_HOST: host,
      FPU_CDP_PORT: cdpPort,
      ...(process.env.FPU_RUNTIME_BENCHMARK
        ? { FPU_RUNTIME_BENCHMARK: process.env.FPU_RUNTIME_BENCHMARK }
        : {}),
      ...(process.env.FPU_SMOKE_REQUIRE_FUSION
        ? { FPU_SMOKE_REQUIRE_FUSION: process.env.FPU_SMOKE_REQUIRE_FUSION }
        : {}),
    },
  });
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

function listLogs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) {
      return listLogs(file);
    }
    return file.endsWith(".log") ? [file] : [];
  });
}

/**
 * `fusionPowerUser.profilesDir` is the documented override for a profiles directory the environment gets
 * wrong, so a single-folder fixture's profiles.yml at its root is reached only through it. Workspace
 * fixtures carry their own per-folder settings.
 */
function configureProfilesThroughSetting(dir) {
  const settingsFile = path.join(dir, ".vscode", "settings.json");
  const settings = existsSync(settingsFile)
    ? JSON.parse(readFileSync(settingsFile, "utf-8"))
    : {};
  settings["fusionPowerUser.profilesDir"] = "${workspaceFolder}";
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

async function findAvailablePort(start) {
  for (let port = start; port < 32_000; port += 1) {
    if (await canBind(port)) {
      return port;
    }
  }
  throw new Error("No CDP port available below the ephemeral range");
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
