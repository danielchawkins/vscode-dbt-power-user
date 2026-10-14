// Tool-environment smoke fixtures. Each entry builds a dbt project in a temporary directory, with the mise or direnv
// setup that decides which `dbt` the extension runs. Forwarders record that they ran, then run the pinned Fusion
// named by FPU_SMOKE_FUSION. Run directly with <dir>, this builds every entry there and prints one JSON line each.
import { createHash } from "crypto";
import {
  accessSync,
  chmodSync,
  constants,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SUITES = ["toolEnvironment"];

/** The first executable named `name` on `pathValue`, as an absolute path; undefined when there is none. */
export function resolveOnPath(name, pathValue = "") {
  for (const dir of pathValue.split(path.delimiter)) {
    const candidate = path.resolve(dir || ".", name);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isExecutableFile(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function shellQuote(text) {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** A dbt project in the single-project shape, with one model to open. */
function makeWorkspace(tmp, name) {
  const workspace = path.join(path.resolve(tmp), `tool-env-${name}`);
  mkdirSync(path.join(workspace, "models"), { recursive: true });
  writeFileSync(
    path.join(workspace, "dbt_project.yml"),
    [
      "name: tool_env",
      "version: 1.0.0",
      "config-version: 2",
      "profile: tool_env",
      "model-paths:",
      "  - models",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "profiles.yml"),
    [
      "tool_env:",
      "  target: test",
      "  outputs:",
      "    test:",
      "      type: duckdb",
      '      path: "target/tool_env.duckdb"',
      "      schema: main",
      "      threads: 1",
      "",
    ].join("\n"),
  );
  writeFileSync(
    path.join(workspace, "models", "model.sql"),
    "select 1 as id\n",
  );
  return workspace;
}

/** Writes an executable `dbt` under `dir` that logs its own path to `log` and runs the pinned Fusion. */
function writeForwarder(workspace, dir, log) {
  const file = path.join(workspace, dir, "dbt");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      "# Smoke forwarder: records that it ran, then runs the pinned Fusion.",
      `echo ${shellQuote(file)} >> ${shellQuote(log)}`,
      'exec "$FPU_SMOKE_FUSION" "$@"',
      "",
    ].join("\n"),
  );
  chmodSync(file, 0o755);
}

function writeMise(workspace, dir, log) {
  writeFileSync(
    path.join(workspace, "mise.toml"),
    `[env]\n_.path = [${JSON.stringify(dir)}]\n`,
  );
  writeForwarder(workspace, dir, log);
}

function writeDirenv(workspace, dir, log) {
  writeFileSync(path.join(workspace, ".envrc"), `PATH_add ${dir}\n`);
  writeForwarder(workspace, dir, log);
}

/** The roots mise trusts for a workspace: as given, and resolved, since the temporary directory may be a link. */
function trustedPaths(workspace) {
  return [...new Set([workspace, realpathSync(workspace)])].join(
    path.delimiter,
  );
}

/**
 * Writes direnv's allow record for the workspace's .envrc under xdgData. direnv names the record by the sha256 of
 * the absolute .envrc path, a newline, and the file's contents; it contains the path. Written for the resolved
 * path too, because the path direnv sees may be the link or the target.
 */
function allowDirenv(workspace, xdgData) {
  const allowDir = path.join(xdgData, "direnv", "allow");
  mkdirSync(allowDir, { recursive: true });
  for (const dir of new Set([workspace, realpathSync(workspace)])) {
    const rc = path.join(dir, ".envrc");
    const hash = createHash("sha256")
      .update(`${rc}\n`)
      .update(readFileSync(rc))
      .digest("hex");
    writeFileSync(path.join(allowDir, hash), `${rc}\n`);
  }
}

function modelOf(workspace) {
  return path.join(workspace, "models", "model.sql");
}

export const TOOL_ENV_FIXTURES = [
  {
    name: "mise",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "mise");
      writeMise(
        workspace,
        "bin",
        path.join(path.resolve(tmp), "invocations.log"),
      );
      return {
        workspace,
        env: { MISE_TRUSTED_CONFIG_PATHS: trustedPaths(workspace) },
        open: modelOf(workspace),
      };
    },
  },
  {
    name: "direnv",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "direnv");
      const xdgData = path.join(path.resolve(tmp), "xdg-data");
      writeDirenv(
        workspace,
        "bin",
        path.join(path.resolve(tmp), "invocations.log"),
      );
      allowDirenv(workspace, xdgData);
      return {
        workspace,
        env: { XDG_DATA_HOME: xdgData },
        open: modelOf(workspace),
      };
    },
  },
  {
    name: "both",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "both");
      const log = path.join(path.resolve(tmp), "invocations.log");
      const xdgData = path.join(path.resolve(tmp), "xdg-data");
      writeMise(workspace, "bin", log);
      writeDirenv(workspace, "direnv-bin", log);
      allowDirenv(workspace, xdgData);
      return {
        workspace,
        env: {
          MISE_TRUSTED_CONFIG_PATHS: trustedPaths(workspace),
          XDG_DATA_HOME: xdgData,
        },
        open: modelOf(workspace),
      };
    },
  },
  {
    name: "untrusted",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "untrusted");
      writeMise(
        workspace,
        "bin",
        path.join(path.resolve(tmp), "invocations.log"),
      );
      return { workspace, env: {}, open: modelOf(workspace) };
    },
  },
  {
    name: "none",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "none");
      return { workspace, env: {}, open: modelOf(workspace) };
    },
  },
  {
    name: "disabled",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "disabled");
      writeMise(
        workspace,
        "bin",
        path.join(path.resolve(tmp), "invocations.log"),
      );
      mkdirSync(path.join(workspace, ".vscode"), { recursive: true });
      writeFileSync(
        path.join(workspace, ".vscode", "settings.json"),
        `${JSON.stringify({ "fusionPowerUser.enabled": false }, null, 2)}\n`,
      );
      return {
        workspace,
        env: { MISE_TRUSTED_CONFIG_PATHS: trustedPaths(workspace) },
        open: modelOf(workspace),
      };
    },
  },
  {
    name: "projectdir",
    suites: SUITES,
    build(tmp) {
      const workspace = makeWorkspace(tmp, "projectdir");
      writeMise(
        workspace,
        "bin",
        path.join(path.resolve(tmp), "invocations.log"),
      );
      const elsewhere = path.join(path.resolve(tmp), "elsewhere");
      mkdirSync(elsewhere, { recursive: true });
      return {
        workspace,
        env: {
          MISE_TRUSTED_CONFIG_PATHS: trustedPaths(workspace),
          DBT_ENGINE_PROJECT_DIR: elsewhere,
        },
        open: modelOf(workspace),
      };
    },
  },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: toolEnvFixtures.mjs <dir>");
    process.exit(2);
  }
  for (const entry of TOOL_ENV_FIXTURES) {
    const { workspace, env, open } = entry.build(dir);
    console.log(JSON.stringify({ name: entry.name, workspace, env, open }));
  }
}
