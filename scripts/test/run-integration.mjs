import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from "@vscode/test-electron";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  labelLayout,
  labelsToPrepare,
  nativeMode,
  ROOT_ENV,
  SPY_LOG_FILE,
  TRUSTED_VSIX_LABEL,
  UNTRUSTED_LABEL,
  VSCODE_VERSION,
  VSIX_LABELS,
} from "./integration-layout.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const fixtures = path.join(root, "src/test/fixtures");
const { labels, rest } = splitLabels(process.argv.slice(2));
const cliLabels = labels.filter((label) => !VSIX_LABELS.includes(label));
const runCli = !labels.length || cliLabels.length > 0;
const vsixLabels = VSIX_LABELS.filter(
  (label) => !labels.length || labels.includes(label),
);

const fusionPath = process.env.FPU_INTEGRATION_DBT_PATH;
if (fusionPath && !path.isAbsolute(fusionPath)) {
  console.error("FPU_INTEGRATION_DBT_PATH must be absolute");
  process.exit(2);
}

const ephemeralRoot = mkdtempSync(
  path.join(realpathSync(tmpdir()), "fpu-integration-"),
);
let cleaned = false;
const cleanup = () => {
  if (cleaned) {
    return;
  }
  cleaned = true;
  // The fixture copies hold the only record of how dbt resolved its profile and what it wrote.
  if (process.env.FPU_KEEP_WORKSPACE) {
    console.log(`FPU_KEEP_WORKSPACE: preserved ${ephemeralRoot}`);
    return;
  }
  rmSync(ephemeralRoot, { recursive: true, force: true });
};

let child;
let signalled = 0;
let exitSignal;
const signalCode = (signal) => (signal === "SIGINT" ? 130 : 143);
const onSignal = (signal) => {
  signalled += 1;
  exitSignal = signal;
  if (child?.exitCode !== null || signalled > 1) {
    killGroup(child, "SIGKILL");
    cleanup();
    process.exit(signalCode(signal));
  }
  // The child leads its own process group, so this reaches the VS Code host and its helpers.
  killGroup(child, signal);
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

/**
 * A `dbt` wrapper that logs each invocation to the spy log and runs the real binary, so a test can assert which dbt
 * processes the extension spawned. It writes `<epoch ms> start <id> <subcommand>` when the invocation starts and
 * `<epoch ms> exit <id> <code>` when it exits. The id is the wrapper's pid and start time, so it pairs the two. Only
 * the first argument is logged, with newlines flattened, so every record is one line. Undefined when no real binary
 * can be found.
 */
function createDbtSpy() {
  const real =
    fusionPath ??
    spawnSync("which", ["dbt"], { encoding: "utf-8" }).stdout.trim();
  if (!real) {
    return undefined;
  }
  const dir = path.join(ephemeralRoot, "spy");
  mkdirSync(dir, { recursive: true });
  const log = path.join(dir, SPY_LOG_FILE);
  writeFileSync(log, "");
  const wrapper = path.join(dir, "dbt");
  writeFileSync(
    wrapper,
    [
      "#!/bin/sh",
      // Dash gives a background job /dev/null as stdin before it applies `0<&0`, so copy stdin to fd 3 first and
      // hand that to the child.
      "exec 3<&0",
      `sub=$(printf '%s' "$1" | tr '\\n' ' ')`,
      "start=$(date +%s)000",
      'id="$$-$start"',
      `printf '%s start %s %s\\n' "$start" "$id" "$sub" >> '${log}'`,
      // Backgrounded so the signal trap can run.
      `'${real}' "$@" <&3 3<&- &`,
      "child=$!",
      // The editor stops a language server by signalling this shell, so pass the signal on to dbt itself.
      `trap 'kill -TERM "$child" 2>/dev/null' TERM INT HUP`,
      'wait "$child"',
      "status=$?",
      // A signalled wait returns early, so reap the child before logging its exit.
      'while kill -0 "$child" 2>/dev/null; do wait "$child"; status=$?; done',
      `printf '%s exit %s %s\\n' "$(date +%s)000" "$id" "$status" >> '${log}'`,
      'exit "$status"',
      "",
    ].join("\n"),
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
}
const dbtSpy = createDbtSpy();

try {
  for (const label of labelsToPrepare(labels)) {
    prepareLabel(label);
  }
  let failed = false;
  if (runCli) {
    const bin = path.join(root, "node_modules/.bin/vscode-test");
    const cliArgs = [
      ...cliLabels.flatMap((label) => ["--label", label]),
      ...rest,
    ];
    failed ||=
      (await run(bin, cliArgs, {
        ...process.env,
        [ROOT_ENV]: ephemeralRoot,
      })) !== 0;
  }
  for (const label of vsixLabels) {
    if (!signalled) {
      failed ||= (await runVsixLaunch(label)) !== 0;
    }
  }
  process.exitCode = exitSignal ? signalCode(exitSignal) : failed ? 1 : 0;
} catch (error) {
  console.error("Failed to run integration tests:", error);
  process.exitCode = 1;
} finally {
  cleanup();
}

/** Separates `--label`/`-l` values, in any yargs form, from the arguments passed through to test-cli. */
function splitLabels(argv) {
  const labels = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const inline = /^(?:--label|-l)=(.+)$/.exec(arg);
    if (inline) {
      labels.push(inline[1]);
    } else if (arg === "--label" || arg === "-l") {
      while (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        labels.push(argv[++i]);
      }
    } else {
      rest.push(arg);
    }
  }
  return { labels, rest };
}

/** Spawns `command` as a process-group leader and resolves its exit code; stray group members are killed on exit. */
function run(command, argv, env) {
  return new Promise((resolve, reject) => {
    child = spawn(command, argv, {
      cwd: root,
      stdio: "inherit",
      env,
      detached: true,
    });
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      killGroup(child, "SIGKILL");
      resolve(exitCode ?? 1);
    });
  });
}

function killGroup(proc, signal) {
  if (!proc?.pid) {
    return;
  }
  try {
    process.kill(-proc.pid, signal);
  } catch {
    // The group has already exited.
  }
}

/**
 * Launches the pinned host directly, since `@vscode/test-electron` always passes `--disable-workspace-trust`. The
 * extension is installed from the VSIX `just package` built: VS Code applies workspace-trust enablement to installed
 * extensions only, so a development-path extension would load in an untrusted workspace regardless of its manifest.
 * `label` selects the untrusted launch or its trusted positive control; the runner reads it from `FPU_VSIX_LABEL`.
 */
async function runVsixLaunch(label) {
  const layout = labelLayout(ephemeralRoot, label);
  const electron = await downloadAndUnzipVSCode(VSCODE_VERSION);
  const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
  const vsix = readLatestVsix();
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(electron);
  const installed = spawnSync(
    cli,
    [
      ...cliArgs,
      `--user-data-dir=${layout.userData}`,
      `--extensions-dir=${layout.extensions}`,
      "--install-extension",
      vsix,
    ],
    { stdio: "inherit", env },
  );
  if (installed.status !== 0) {
    return installed.status ?? 1;
  }
  // The runner is a development extension that only hosts the mocha entry; it declares trust support so it loads.
  cpSync(
    path.join(root, "src/test/integration/untrusted/runner-package.json"),
    path.join(root, "out/test/integration/untrusted/package.json"),
  );
  return run(
    electron,
    [
      layout.workspace,
      `--user-data-dir=${layout.userData}`,
      `--extensions-dir=${layout.extensions}`,
      `--extensionDevelopmentPath=${path.join(root, "out/test/integration/untrusted")}`,
      `--extensionTestsPath=${path.join(root, "out/test/integration/untrusted/index.js")}`,
      "--skip-welcome",
      "--skip-release-notes",
      "--use-inmemory-secretstorage",
    ],
    {
      ...env,
      FPU_VSIX_EXTENSIONS_DIR: layout.extensions,
      FPU_VSIX_LABEL: label,
    },
  );
}

/** The VSIX recorded by `just package`; the VSIX launches refuse to guess one. */
function readLatestVsix() {
  const record = path.join(root, "out/latest-vsix");
  if (!existsSync(record)) {
    throw new Error(
      "The VSIX launches test the packaged VSIX; run `just package` first.",
    );
  }
  return readFileSync(record, "utf8").trim();
}

function prepareLabel(label) {
  const layout = labelLayout(ephemeralRoot, label);
  mkdirSync(layout.decoyProfiles, { recursive: true });
  mkdirSync(layout.extensions, { recursive: true });
  const trustSettings = {
    [UNTRUSTED_LABEL]: {
      "security.workspace.trust.enabled": true,
      "security.workspace.trust.startupPrompt": "never",
      "security.workspace.trust.untrustedFiles": "open",
    },
    [TRUSTED_VSIX_LABEL]: { "security.workspace.trust.enabled": false },
  }[label];
  const userSettings = {
    ...trustSettings,
    // Local history copies each saved file with uv_fs_copyfile. A test that rewrites a file shorter during that
    // copy leaves libuv's sendfile loop retrying a zero-byte copy forever on Linux, so the host never quits.
    "workbench.localHistory.enabled": false,
    ...(dbtSpy && label !== UNTRUSTED_LABEL
      ? { "fusionPowerUser.dbtPath": dbtSpy }
      : {}),
  };
  writeJson(path.join(layout.userData, "User", "settings.json"), userSettings);
  const mode = nativeMode(label);
  if (mode) {
    prepareNativeEditor(layout.workspace, mode);
  } else if (label === "symlinked") {
    // Fusion canonicalizes --project-dir, so the opened root must differ from the realpath it reports.
    const real = path.join(layout.base, "single-project-real");
    prepareSingleProject(real);
    symlinkSync(real, layout.workspace);
  } else {
    prepareSingleProject(layout.workspace);
  }
}

/**
 * Copies the single-project fixture with a buildable model pair. `fusionPowerUser.profilesDir` is the only route
 * to the fixture's root-level profiles.yml, because the label environment points dbt's variables at a decoy.
 */
function prepareSingleProject(dir) {
  cpSync(path.join(fixtures, "single-project"), dir, { recursive: true });
  writeJson(path.join(dir, ".vscode", "settings.json"), {
    "fusionPowerUser.profilesDir": "${workspaceFolder}",
  });
  const models = path.join(dir, "models");
  rmSync(path.join(models, "broken_ref.sql"), { force: true });
  writeFileSync(path.join(models, "base.sql"), "select 1 as id\n");
  writeFileSync(
    path.join(models, "child.sql"),
    'select * from {{ ref("base") }}\n',
  );
}

/**
 * Copies the native-editor fixture with one static-analysis mode and creates its sources with `setup_raw`.
 * `project` sets no mode and puts `+static_analysis: strict` in dbt_project.yml instead.
 */
function prepareNativeEditor(dir, mode) {
  cpSync(path.join(fixtures, "native-editor"), dir, { recursive: true });
  writeJson(path.join(dir, ".vscode", "settings.json"), {
    "fusionPowerUser.staticAnalysis": mode,
    "fusionPowerUser.profilesDir": "${workspaceFolder}",
    "fusionPowerUser.lint.enabled": false,
  });
  if (mode === "project") {
    appendFileSync(
      path.join(dir, "dbt_project.yml"),
      "models:\n  lineage_probe:\n    +static_analysis: strict\n",
    );
  }
  // A second output for the target-change suite; its database is never set up.
  // The prod output shares probe.duckdb in its own schema, so a prod-only relation can exist next to a dev one.
  appendFileSync(
    path.join(dir, "profiles.yml"),
    "    ci:\n      type: duckdb\n      path: probe_ci.duckdb\n" +
      "    prod:\n      type: duckdb\n      path: probe.duckdb\n      schema: prod\n",
  );
  const dbt = fusionPath ?? "dbt";
  // The prod build runs only if setup_raw succeeds; the first failing step is the one recorded.
  const steps = [
    ["run-operation", "setup_raw", "--profiles-dir", dir],
    ["run", "--target", "prod", "-s", "+prod_only", "--profiles-dir", dir],
  ];
  let command = "";
  let setup;
  for (const args of steps) {
    command = `${dbt} ${args.join(" ")}`;
    setup = spawnSync(dbt, args, {
      cwd: dir,
      encoding: "utf-8",
      timeout: 120_000,
    });
    if (setup.status !== 0) {
      break;
    }
  }
  if (setup.status === 0) {
    // defer reads the manifest of the prod build from here.
    mkdirSync(path.join(dir, "state"), { recursive: true });
    cpSync(
      path.join(dir, "target", "manifest.json"),
      path.join(dir, "state", "manifest.json"),
    );
  }
  writeJson(path.join(dir, ".native-editor-setup.json"), {
    command,
    cwd: dir,
    exitCode: setup.status,
    error: setup.error?.message,
    outputTail: `${setup.stdout ?? ""}\n${setup.stderr ?? ""}`
      .trim()
      .slice(-600),
  });
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}
