import {
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";
import { spawnSync } from "child_process";
import { copyFileSync, cpSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

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
const remoteDebuggingPort = process.env.FPU_CDP_PORT;

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
const cleanup = () => {
  rmSync(userDataDir, { recursive: true, force: true });
  rmSync(extensionsDir, { recursive: true, force: true });
  rmSync(workspaceParent, { recursive: true, force: true });
};
process.once("exit", cleanup);

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

try {
  await runTests({
    vscodeExecutablePath: hostApp,
    extensionTestsPath: path.join(root, "out/test/smoke/index.js"),
    launchArgs: [
      workspaceDir,
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      ...(remoteDebuggingPort
        ? [`--remote-debugging-port=${remoteDebuggingPort}`]
        : []),
      ...(host === "cursor"
        ? ["--skip-onboarding", "--suppress-popups-on-startup"]
        : []),
      "--disable-workspace-trust",
      "--skip-release-notes",
      "--skip-welcome",
    ],
    extensionTestsEnv: {
      FPU_SMOKE_HOST: host,
    },
  });
} finally {
  process.removeListener("exit", cleanup);
  cleanup();
}
