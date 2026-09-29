import { describe, expect, it, jest } from "@jest/globals";
import * as path from "path";
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
}

function fakeProcesses(result: Partial<CommandProcessResult> = {}) {
  const calls: Call[] = [];
  const factory = {
    createCommandProcessExecution: (call: Call) => {
      calls.push(call);
      return {
        complete: async () => ({
          stdout: "",
          stderr: "",
          fullOutput: "",
          exitCode: 0,
          ...result,
        }),
      };
    },
  } as unknown as CommandProcessExecutionFactory;
  return { calls, factory };
}

function fakeTerminal() {
  const warn = jest.fn();
  const noop = () => undefined;
  const terminal: DBTTerminal = {
    show: async () => undefined,
    log: noop,
    trace: noop,
    debug: noop,
    info: noop,
    warn,
    error: noop,
    dispose: noop,
  };
  return { terminal, warn };
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
