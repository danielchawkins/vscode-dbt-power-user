import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { toCliArgs } from "../../core/cli";
import {
  ProjectSnapshot,
  ProjectSnapshotSettings,
  resolveProjectSnapshot,
} from "../../core/project";
import { DBTCommand } from "../../dbt_integration/dbtIntegration";
import { DBTNode, NodeMetaData } from "../../dbt_integration/domain";
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

  it("merges the run environment over the executable's", async () => {
    const { calls, factory } = fakeProcesses();
    const cli = new FusionCli(
      executable,
      () => snapshot(),
      factory,
      fakeTerminal().terminal,
    );
    await cli.run({ kind: "debug" }, { env: { B: "run", C: "3" } });
    expect(calls[0].envVars).toEqual({ A: "1", B: "run", C: "3" });
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

describe("FusionCli as DBTProjectIntegration", () => {
  it("reads name, paths and target from the snapshot", () => {
    const { cli } = cliWith({}, () => snapshot({ target: "prod" }));
    expect(cli.getProjectName()).toBe("proj");
    expect(cli.getSelectedTarget()).toBe("prod");
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

  it("gives a queued command this project's argv and runs it with terminal output", async () => {
    const { cli, calls, show } = cliWith();
    const command = new DBTCommand(
      "Running",
      ["run", "--select", "+a", "--threads", "4"],
      true,
      true,
      true,
    );
    const prepared = await cli.runModel(command);
    const expected = toCliArgs(
      snapshot(),
      { kind: "run", select: "+a" },
      () => "missing",
    );
    expect(prepared.args).toEqual(expected);
    await prepared.execute();
    expect(argsAfterExecutable(calls[0])).toEqual(expected);
    expect(calls[0].streamed).toBe(true);
    expect(show).toHaveBeenCalledWith(true);
  });

  it("maps each queued member to its command kind", async () => {
    const { cli } = cliWith();
    const cmd = (...args: string[]) => new DBTCommand("", args);
    const kinds = await Promise.all([
      cli.buildModel(cmd("build", "--select", "a")),
      cli.buildProject(cmd("build")),
      cli.runTest(cmd("test", "--select", "a")),
      cli.runModelTest(cmd("test", "--select", "a")),
      cli.compileModel(cmd("compile", "--select", "a+")),
    ]);
    const s = snapshot();
    const probe = () => "missing" as const;
    expect(kinds.map((c) => c.args)).toEqual([
      toCliArgs(s, { kind: "build", select: "a" }, probe),
      toCliArgs(s, { kind: "build" }, probe),
      toCliArgs(s, { kind: "test", select: "a" }, probe),
      toCliArgs(s, { kind: "test", select: "a" }, probe),
      toCliArgs(s, { kind: "compile", select: "a+" }, probe),
    ]);
  });

  it("runs deps, clean and debug immediately and rejects anything else", async () => {
    const { cli, calls } = cliWith({ fullOutput: "ok" });
    for (const kind of ["deps", "clean", "debug"]) {
      await expect(
        cli.executeCommandImmediately(new DBTCommand("", [kind])),
      ).resolves.toMatchObject({
        fullOutput: "ok",
      });
    }
    expect(calls.map((c) => c.args?.[0])).toEqual(["deps", "clean", "debug"]);
    expect(calls.every((c) => !c.streamed)).toBe(true);
    await expect(
      cli.executeCommandImmediately(
        new DBTCommand("", ["deps", "--add-package", "x"]),
      ),
    ).rejects.toThrow("Unsupported command");
  });

  it("compiles a node, preferring the model's record, and throws stderr errors", async () => {
    const ok = cliWith({
      stdout: [
        compiled("test sql", "test.p.t"),
        compiled("model sql", "model.p.a"),
      ].join("\n"),
    });
    await expect(ok.cli.unsafeCompileNode("a")).resolves.toBe("model sql");
    expect(ok.calls[0].args?.slice(0, 3)).toEqual(["compile", "--select", "a"]);

    const failing = cliWith({
      stdout: compiled("x"),
      stderr: log("error", "bad"),
    });
    await expect(failing.cli.unsafeCompileNode("a")).rejects.toThrow("bad");
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

  it("reads model columns and bulk schemas from the compiled record", async () => {
    const columns = [{ column: "id", dtype: "int" }];
    const model = cliWith({ stdout: compiled(columns) });
    await expect(model.cli.getColumnsOfModel("m")).resolves.toEqual(columns);
    expect(model.calls[0].args?.[2]).toContain("ref('m')");

    const bulk = cliWith({ stdout: compiled({ "model.p.m": columns }) });
    await expect(
      bulk.cli.getBulkSchemaFromDB([], new AbortController().signal),
    ).resolves.toEqual({});
    expect(bulk.calls).toHaveLength(0);
    const signal = new AbortController().signal;
    await expect(
      bulk.cli.getBulkSchemaFromDB(
        [{ name: "m", unique_id: "model.p.m" }] as unknown as DBTNode[],
        signal,
      ),
    ).resolves.toEqual({ "model.p.m": columns });
    expect(bulk.calls[0].args?.[2]).not.toContain("\n");
  });

  it("logs and skips a model that fails in getBulkCompiledSQL", async () => {
    const { cli, error } = cliWith((call) =>
      call.args?.[2] === "bad"
        ? { stderr: log("error", "no") }
        : { stdout: compiled("sql", "model.p.ok") },
    );
    const nodes = [
      { unique_id: "model.p.ok", name: "ok" },
      { unique_id: "model.p.bad", name: "bad" },
    ] as unknown as NodeMetaData[];
    await expect(cli.getBulkCompiledSQL(nodes)).resolves.toEqual({
      "model.p.ok": "sql",
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  describe("getCatalog", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "fusion-cli-catalog-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const snapshotAt = () => ({
      ...snapshot(),
      paths: { ...snapshot().paths, targetPath: dir },
    });

    it("is empty when the manifest is missing", async () => {
      const { cli, calls } = cliWith({}, snapshotAt);
      await expect(cli.getCatalog()).resolves.toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it("joins warehouse columns to materialised models and sources", async () => {
      writeFileSync(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          nodes: {
            a: {
              name: "a",
              database: "d",
              schema: "s",
              resource_type: "model",
            },
            e: {
              name: "e",
              resource_type: "model",
              config: { materialized: "ephemeral" },
            },
            t: { name: "t", resource_type: "test" },
          },
          sources: {
            x: {
              name: "x",
              database: "d",
              schema: "raw",
              source_name: "src",
              identifier: "x_tbl",
            },
          },
        }),
      );
      const { cli, calls } = cliWith(
        (call) =>
          String(call.args?.[2]).includes("ref(name)")
            ? {
                stdout: compiled([
                  { ref_name: "a", column_name: "id", column_type: "int" },
                ]),
              }
            : {
                stdout: compiled([
                  {
                    source_name: "src",
                    identifier: "x_tbl",
                    column_name: "v",
                    column_type: "text",
                  },
                ]),
              },
        snapshotAt,
      );
      await expect(cli.getCatalog()).resolves.toEqual([
        {
          table_database: "d",
          table_schema: "s",
          table_name: "a",
          column_name: "id",
          column_type: "int",
        },
        {
          table_database: "d",
          table_schema: "raw",
          table_name: "x",
          column_name: "v",
          column_type: "text",
        },
      ]);
      expect(calls).toHaveLength(2);
      expect(String(calls[0].args?.[2])).toContain('["a"]');
    });
  });
});
