import { describe, expect, it, jest } from "@jest/globals";
import * as path from "path";
import { toCliArgs } from "../../core/cli";
import {
  ProjectSnapshot,
  ProjectSnapshotSettings,
  resolveProjectSnapshot,
} from "../../core/project";
import { DBTTerminal } from "../../dbt_integration/terminal";
import {
  CommandProcessExecutionFactory,
  CommandProcessResult,
} from "../../fusion/commandProcessExecution";
import { FusionCli } from "../../fusion/fusionCli";
import { noSettings, snapshotFolder } from "../arbitraries/projectSnapshot";

const root = path.join(snapshotFolder, "proj");

function snapshot(
  settings: Partial<ProjectSnapshotSettings> = {},
): ProjectSnapshot {
  return resolveProjectSnapshot({
    root,
    folder: snapshotFolder,
    firstWorkspaceFolder: snapshotFolder,
    userHome: "/home/u",
    environment: {},
    lspCompiledOutputOverride: undefined,
    settings: { ...noSettings, ...settings },
    projectFile: { kind: "parsed", text: "", config: { name: "proj" } },
  });
}

interface Call {
  command: string;
  args?: string[];
  cwd?: string;
  envVars?: Record<string, string | undefined>;
  signal?: AbortSignal;
  streamed?: boolean;
}

function fakeProcesses(
  result:
    | Partial<CommandProcessResult>
    | ((call: Call) => Partial<CommandProcessResult>) = {},
) {
  const calls: Call[] = [];
  const factory = {
    createCommandProcessExecution: (call: Call) => {
      calls.push(call);
      const complete = async () => ({
        stdout: "",
        stderr: "",
        fullOutput: "",
        exitCode: 0,
        ...(typeof result === "function" ? result(call) : result),
      });
      return {
        complete,
        completeWithTerminalOutput: () => {
          call.streamed = true;
          return complete();
        },
      };
    },
  } as unknown as CommandProcessExecutionFactory;
  return { calls, factory };
}

function fakeTerminal() {
  const warn = jest.fn();
  const error = jest.fn();
  const show = jest.fn(async (_status: boolean) => undefined);
  const noop = () => undefined;
  const terminal: DBTTerminal = {
    show,
    log: noop,
    trace: noop,
    debug: noop,
    info: noop,
    warn,
    error,
    dispose: noop,
  };
  return { terminal, warn, error, show };
}

const executable = { path: "/bin/dbt", env: { A: "1", B: "exe" } };

describe("FusionCli", () => {
  it("runs the executable in the project root with --project-dir", async () => {
    const { calls, factory } = fakeProcesses();
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      factory,
      fakeTerminal().terminal,
    );
    await cli.run({ kind: "parse" });
    expect(calls[0].command).toBe("/bin/dbt");
    expect(calls[0].cwd).toBe(root);
    const args = calls[0].args ?? [];
    expect(args[args.indexOf("--project-dir") + 1]).toBe(root);
  });

  it("reads the snapshot on every run", async () => {
    const { calls, factory } = fakeProcesses();
    let current = snapshot({ target: "a" });
    const cli = new FusionCli(
      executable,
      () => current,
      factory,
      fakeTerminal().terminal,
    );
    await cli.run({ kind: "parse" });
    current = snapshot({ target: "b" });
    await cli.run({ kind: "parse" });
    const targets = calls.map(
      ({ args = [] }) => args[args.indexOf("--target") + 1],
    );
    expect(targets).toEqual(["a", "b"]);
  });

  it("merges the run environment over the snapshot's, ignoring the executable's", async () => {
    const { calls, factory } = fakeProcesses();
    const cli = new FusionCli(
      executable,
      () => ({
        ...snapshot(),
        invocation: {
          ...snapshot().invocation,
          environment: { S: "1", B: "snapshot" },
        },
      }),
      factory,
      fakeTerminal().terminal,
    );
    await cli.run({ kind: "debug" }, { env: { B: "run", C: "3" } });
    expect(calls[0].envVars).toEqual({ S: "1", B: "run", C: "3" });
  });

  it("warns once about an unusable defer state path", async () => {
    const manifestPath = path.join(root, "no-such-state", "manifest.json");
    const { factory } = fakeProcesses();
    const { terminal, warn } = fakeTerminal();
    const deferring = snapshot({
      deferPerProject: {
        proj: {
          deferToProduction: true,
          favorState: false,
          manifestPathForDeferral: manifestPath,
        },
      },
    });
    const cli = new FusionCli(executable, () => deferring, factory, terminal);
    await cli.run({ kind: "run", select: "m" });
    await cli.run({ kind: "run", select: "m" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][1])).toContain(manifestPath);
  });

  it("warns once when defer is enabled without a state path", async () => {
    const { factory, calls } = fakeProcesses();
    const { terminal, warn } = fakeTerminal();
    const deferring = snapshot({
      deferPerProject: { proj: { deferToProduction: true, favorState: false } },
    });
    const cli = new FusionCli(executable, () => deferring, factory, terminal);
    await cli.run({ kind: "run", select: "m" });
    await cli.run({ kind: "run", select: "m" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "deferMissingManifestPath",
      expect.stringContaining("fusionPowerUser.defer.perProject"),
      false,
    );
    expect(calls[0].args).not.toContain("--state");
  });

  it("warns about an unusable defer state path only for deferrable commands", async () => {
    const { factory } = fakeProcesses({
      stdout: JSON.stringify({
        data: { compiled: "x", preview: "[]" },
      }),
    });
    const { terminal, warn } = fakeTerminal();
    const deferring = snapshot({
      deferPerProject: {
        proj: {
          deferToProduction: true,
          favorState: false,
          manifestPathForDeferral: path.join(root, "no-such-state"),
        },
      },
    });
    const cli = new FusionCli(executable, () => deferring, factory, terminal);
    await cli.run({ kind: "parse" });
    await cli.show("select 1", 1);
    await cli.compileInline("select 1");
    expect(warn).not.toHaveBeenCalled();
    await cli.run({ kind: "compile", select: "m" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads compiled SQL from stdout after checking stderr", async () => {
    const ok = fakeProcesses({
      stdout: JSON.stringify({ data: { compiled: "select 1" } }),
    });
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      ok.factory,
      fakeTerminal().terminal,
    );
    await expect(cli.compileInline("select {{ 1 }}")).resolves.toBe("select 1");

    const failing = fakeProcesses({
      stdout: JSON.stringify({ data: { compiled: "select 1" } }),
      stderr: JSON.stringify({ info: { level: "error", msg: "boom" } }),
    });
    const failingCli = new FusionCli(
      executable,
      () => snapshot(),
      failing.factory,
      fakeTerminal().terminal,
    );
    await expect(failingCli.compileInline("x")).rejects.toThrow("boom");
  });

  it("ignores stderr lines that are not JSON and non-error records", async () => {
    const columns = [{ column: "id", dtype: "int" }];
    const { factory } = fakeProcesses({
      stdout: JSON.stringify({ data: { compiled: JSON.stringify(columns) } }),
      stderr: [
        "warning: text noise",
        JSON.stringify({ info: { level: "warn", msg: "w" } }),
      ].join("\n"),
    });
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      factory,
      fakeTerminal().terminal,
    );
    await expect(cli.getColumnsOfModel("m")).resolves.toEqual(columns);

    const failing = fakeProcesses({
      stdout: JSON.stringify({ data: { compiled: "[]" } }),
      stderr: [
        "text noise",
        JSON.stringify({ info: { level: "fatal", msg: "down" } }),
      ].join("\n"),
    });
    const failingCli = new FusionCli(
      executable,
      () => snapshot(),
      failing.factory,
      fakeTerminal().terminal,
    );
    await expect(failingCli.getColumnsOfModel("m")).rejects.toThrow("down");
  });

  it("returns the show preview", async () => {
    const { calls, factory } = fakeProcesses({
      stdout: JSON.stringify({
        data: { preview: JSON.stringify([{ id: 1 }]) },
      }),
    });
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      factory,
      fakeTerminal().terminal,
    );
    await expect(cli.show("select 1 as id", 5)).resolves.toEqual({
      columns: ["id"],
      rows: [[1]],
      compiledSql: "",
    });
    expect(calls[0].args).toContain("--limit");
  });

  it("throws Fusion's own error when a show fails without a preview", async () => {
    const { factory } = fakeProcesses({
      stdout: [
        log("debug", "Started running model main.inline"),
        log(
          "error",
          "Catalog Error: Table with name stg_orders does not exist!",
        ),
      ].join("\n"),
    });
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      factory,
      fakeTerminal().terminal,
    );
    await expect(cli.show("select 1 as id", 5)).rejects.toThrow(
      /^Catalog Error: Table with name stg_orders does not exist!$/,
    );
  });
});

const log = (level: string, msg: string) =>
  JSON.stringify({ info: { level, msg } });
const compiled = (value: unknown, uniqueId?: string) =>
  JSON.stringify({
    data: {
      compiled: typeof value === "string" ? value : JSON.stringify(value),
      ...(uniqueId ? { unique_id: uniqueId } : {}),
    },
  });

function cliWith(
  result: Parameters<typeof fakeProcesses>[0] = {},
  current: () => ProjectSnapshot = () => snapshot(),
) {
  const processes = fakeProcesses(result);
  const terminal = fakeTerminal();
  const cli = new FusionCli(
    executable,
    current,
    processes.factory,
    terminal.terminal,
  );
  return { cli, ...processes, ...terminal };
}

const argsAfterExecutable = (call: Call) => call.args ?? [];

describe("FusionCli project state and commands", () => {
  it("reads name and paths from the snapshot", () => {
    const { cli } = cliWith();
    expect(cli.getProjectName()).toBe("proj");
    expect(cli.getTargetPath()).toBe(path.join(root, "target"));
    expect(cli.getModelPaths()).toEqual([path.join(root, "models")]);
    expect(cli.getSeedPaths()).toEqual([path.join(root, "seeds")]);
    expect(cli.getMacroPaths()).toEqual([path.join(root, "macros")]);
    expect(cli.getPackageInstallPath()).toBe(path.join(root, "dbt_packages"));
  });

  it("reads the project file once for the getters until refreshProjectConfig", async () => {
    let targetPath = "target";
    const read = jest.fn(() =>
      resolveProjectSnapshot({
        root,
        folder: snapshotFolder,
        firstWorkspaceFolder: snapshotFolder,
        userHome: "/home/u",
        environment: {},
        lspCompiledOutputOverride: undefined,
        settings: noSettings,
        projectFile: {
          kind: "parsed",
          text: "",
          config: { name: "proj", "target-path": targetPath },
        },
      }),
    );
    const { cli } = cliWith({}, read);
    for (let i = 0; i < 50; i++) {
      cli.getTargetPath();
      cli.getProjectName();
    }
    expect(read).toHaveBeenCalledTimes(1);
    targetPath = "out";
    expect(cli.getTargetPath()).toBe(path.join(root, "target"));
    await cli.refreshProjectConfig();
    expect(cli.getTargetPath()).toBe(path.join(root, "out"));
  });

  it("turns parse stderr into errors then warnings on the project file", async () => {
    const { cli } = cliWith({
      stderr: [
        log("warn", "w1"),
        log("error", "e1"),
        "not json",
        log("info", "i"),
      ].join("\n"),
    });
    await cli.rebuildManifest();
    const diagnostics = cli.getDiagnostics().rebuildManifestDiagnostics;
    expect(diagnostics.map((d) => [d.severity, d.message, d.category])).toEqual(
      [
        ["error", "e1", "manifest-rebuild"],
        ["warning", "w1", "manifest-rebuild"],
      ],
    );
    expect(diagnostics[0].filePath).toBe(path.join(root, "dbt_project.yml"));
  });

  it("clears parse diagnostics after a clean parse", async () => {
    let stderr = log("error", "e1");
    const { cli } = cliWith(() => ({ stderr }));
    await cli.rebuildManifest();
    stderr = "";
    await cli.rebuildManifest();
    expect(cli.getDiagnostics().rebuildManifestDiagnostics).toEqual([]);
  });

  it("reports a parse that cannot run as one command-execution diagnostic", async () => {
    const factory = {
      createCommandProcessExecution: () => ({
        complete: () => Promise.reject(new Error("spawn failed")),
      }),
    } as unknown as CommandProcessExecutionFactory;
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      factory,
      fakeTerminal().terminal,
    );
    await cli.rebuildManifest();
    const [diagnostic, ...rest] =
      cli.getDiagnostics().rebuildManifestDiagnostics;
    expect(rest).toEqual([]);
    expect(diagnostic.category).toBe("command-execution");
    expect(diagnostic.message).toContain("spawn failed");
  });

  it("aborts a parse still in flight when another starts", async () => {
    const { cli, calls } = cliWith();
    const first = cli.rebuildManifest();
    const second = cli.rebuildManifest();
    await Promise.all([first, second]);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
  });

  it("shapes executeSQL rows and cancels through the query's signal", async () => {
    const { cli, calls } = cliWith({
      stdout: [
        JSON.stringify({ data: { sql: "select 1 as id" } }),
        JSON.stringify({ data: { preview: JSON.stringify([{ id: 1 }]) } }),
      ].join("\n"),
    });
    const execution = await cli.executeSQL("select 1 as id", 5, "m");
    await expect(execution.executeQuery()).resolves.toEqual({
      table: { column_names: ["id"], column_types: ["string"], rows: [[1]] },
      compiled_sql: "select 1 as id",
      raw_sql: "select 1 as id",
      modelName: "m",
    });
    await execution.cancel();
    expect(calls[0].signal?.aborted).toBe(true);
  });

  it("prepares a queued command with this project's argv and runs it with terminal output", async () => {
    const { cli, calls, show } = cliWith();
    const prepared = cli.prepare({ kind: "run", select: "+a" });
    const expected = toCliArgs(
      snapshot(),
      { kind: "run", select: "+a" },
      () => "missing",
    );
    expect(prepared.args).toEqual(expected);
    expect(prepared.statusMessage).toBe("Running dbt model...");
    expect([
      prepared.focus,
      prepared.showProgress,
      prepared.logToTerminal,
    ]).toEqual([true, true, true]);
    await prepared.execute();
    expect(argsAfterExecutable(calls[0])).toEqual(expected);
    expect(calls[0].streamed).toBe(true);
    expect(show).toHaveBeenCalledWith(true);
  });

  it("prepares each queued kind with its argv and status", () => {
    const { cli } = cliWith();
    const s = snapshot();
    const probe = () => "missing" as const;
    const kinds = [
      { kind: "build", select: "a" },
      { kind: "build" },
      { kind: "test", select: "a" },
      { kind: "compile", select: "a+" },
    ] as const;
    expect(
      kinds.map((k) => {
        const { args, statusMessage } = cli.prepare(k);
        return { args, statusMessage };
      }),
    ).toEqual([
      {
        args: toCliArgs(s, kinds[0], probe),
        statusMessage: "Building dbt model...",
      },
      {
        args: toCliArgs(s, kinds[1], probe),
        statusMessage: "Building dbt project...",
      },
      {
        args: toCliArgs(s, kinds[2], probe),
        statusMessage: "Testing dbt model...",
      },
      {
        args: toCliArgs(s, kinds[3], probe),
        statusMessage: "Compiling dbt models...",
      },
    ]);
  });

  it("runs deps, clean and debug without terminal output", async () => {
    const { cli, calls } = cliWith({ fullOutput: "ok" });
    for (const kind of ["deps", "clean", "debug"] as const) {
      await expect(cli.run({ kind })).resolves.toMatchObject({
        fullOutput: "ok",
      });
    }
    expect(calls.map((c) => c.args?.[0])).toEqual(["deps", "clean", "debug"]);
    expect(calls.every((c) => !c.streamed)).toBe(true);
  });

  it("reads source columns from quiet stdout and throws on any stderr", async () => {
    const columns = [{ column: "id", dtype: "int" }];
    const ok = cliWith({ stdout: JSON.stringify(columns) + "\n" });
    await expect(ok.cli.getColumnsOfSource("s", "t")).resolves.toEqual(columns);
    expect(ok.calls[0].args).toContain("--quiet");
    expect(ok.calls[0].args?.[2]).toContain("source('s', 't')");

    const failing = cliWith({ stderr: "boom" });
    await expect(failing.cli.getColumnsOfSource("s", "t")).rejects.toThrow(
      "boom",
    );
  });

  it("reads model columns from the compiled record", async () => {
    const columns = [{ column: "id", dtype: "int" }];
    const model = cliWith({ stdout: compiled(columns) });
    await expect(model.cli.getColumnsOfModel("m")).resolves.toEqual(columns);
    expect(model.calls[0].args?.[2]).toContain("ref('m')");
  });
});
