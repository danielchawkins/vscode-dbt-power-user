import * as fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Uri } from "vscode";
import type { Log } from "../../core/log";
import { ProjectSnapshot } from "../../core/project";
import { DBTCommand } from "../../dbt_integration/dbtIntegration";
import { RunModelType } from "../../dbt_integration/domain";
import { FusionCli } from "../../fusion/fusionCli";
import { CommandQueue } from "../../projects/commandQueue";
import { DbtTaskTerminal } from "../../projects/dbtTask";
import {
  modelParamsFor,
  ProjectCommandDeps,
  queueCli,
  selection,
} from "../../projects/projectCommands";

describe("selection", () => {
  it("wraps the model name in its graph operators", () => {
    const params = {
      plusOperatorLeft: "+",
      modelName: "orders",
      plusOperatorRight: "",
    };
    expect(selection(params)).toBe("+orders");
  });
});

describe("modelParamsFor", () => {
  const model = Uri.file("/project/models/orders.sql");

  beforeEach(() => {
    vi.spyOn(fs.realpathSync, "native").mockImplementation(
      (value) => value as string,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [undefined, "", ""],
    [RunModelType.RUN_PARENTS, "+", ""],
    [RunModelType.RUN_CHILDREN, "", "+"],
    [RunModelType.BUILD_PARENTS, "+", ""],
    [RunModelType.BUILD_CHILDREN, "", "+"],
    [RunModelType.BUILD_CHILDREN_PARENTS, "+", "+"],
    [RunModelType.TEST, "", ""],
  ])("maps %s to operators '%s' and '%s'", (type, left, right) => {
    expect(modelParamsFor(model, type)).toEqual({
      plusOperatorLeft: left,
      modelName: "orders",
      plusOperatorRight: right,
    });
  });

  it("names the model after the file's real path", () => {
    vi.spyOn(fs.realpathSync, "native").mockReturnValue(
      "/elsewhere/customers.sql",
    );

    expect(modelParamsFor(model).modelName).toBe("customers");
  });
});

describe("queueCli", () => {
  it.each([
    [{ kind: "build" } as const, "dbt build"],
    [
      { kind: "run", select: "orders" } as const,
      "dbt run --select orders --full-refresh",
    ],
  ])("reports %o as %s when prepare throws", async (cli, status) => {
    const notifyFailed = vi.fn();
    const deps = {
      cli: () =>
        ({
          prepare: () => {
            throw new Error("no dbt");
          },
        }) as unknown as FusionCli,
      snapshot: () =>
        ({
          invocation: { commandParams: { run: ["--full-refresh"] } },
        }) as unknown as ProjectSnapshot,
      notifyFailed,
      terminal: { error: vi.fn() } as unknown as Log,
    } as unknown as ProjectCommandDeps;

    await expect(
      queueCli(deps, cli, new DbtTaskTerminal(() => undefined)),
    ).rejects.toThrow("no dbt");

    expect(notifyFailed).toHaveBeenCalledWith(status, "Error: no dbt");
  });

  it("notifies failure and queues nothing when prepare throws", async () => {
    const enqueue = vi.fn();
    const notifyFailed = vi.fn();
    const error = vi.fn();
    const deps: ProjectCommandDeps = {
      commandQueue: { enqueue } as unknown as CommandQueue,
      cli: () =>
        ({
          prepare: () => {
            throw new Error("no dbt");
          },
        }) as unknown as FusionCli,
      snapshot: () =>
        ({
          invocation: { commandParams: { run: ["--full-refresh"] } },
        }) as unknown as ProjectSnapshot,
      withRunResults: (run) => run(),
      notifyFailed,
      terminal: { error } as unknown as Log,
    };

    await expect(
      queueCli(
        deps,
        { kind: "run", select: "orders" },
        new DbtTaskTerminal(() => undefined),
      ),
    ).rejects.toThrow("no dbt");

    expect(enqueue).not.toHaveBeenCalled();
    expect(notifyFailed).toHaveBeenCalledWith(
      "dbt run --select orders --full-refresh",
      "Error: no dbt",
    );
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("queueCli with a prepared command", () => {
  function enqueueCommand(
    deps: ProjectCommandDeps,
    command: DBTCommand,
    terminal: DbtTaskTerminal,
  ) {
    const cli = () => ({ prepare: () => command }) as unknown as FusionCli;
    return queueCli({ ...deps, cli }, { kind: "run", select: "a" }, terminal);
  }

  function depsWith() {
    const deps: ProjectCommandDeps = {
      commandQueue: new CommandQueue(),
      cli: () => ({}) as FusionCli,
      snapshot: () => ({}) as ProjectSnapshot,
      withRunResults: vi.fn((run) => run()),
      notifyFailed: vi.fn(),
      terminal: {} as Log,
    };
    return deps;
  }

  function command(stdout = "", exitCode = 0) {
    const command = new DBTCommand("Running", ["run", "--select", "a"]);
    const execute = vi.fn(
      async (
        _c: DBTCommand,
        _signal?: AbortSignal,
        onOutput?: (chunk: string) => void,
      ) => {
        onOutput?.("done\n");
        return { stdout, stderr: "", fullOutput: stdout, exitCode };
      },
    );
    command.setExecutionStrategy({ execute });
    return { command, execute };
  }

  function recorded(terminal: DbtTaskTerminal) {
    const written: string[] = [];
    terminal.onDidWrite((text) => written.push(text));
    const closed = new Promise((resolve) => terminal.onDidClose(resolve));
    return { written, closed };
  }

  it("runs in the terminal inside the run-results read and settles with the result", async () => {
    const deps = depsWith();
    const { command: c, execute } = command("", 2);
    const terminal = new DbtTaskTerminal(() => undefined);
    const { closed } = recorded(terminal);

    await expect(enqueueCommand(deps, c, terminal)).resolves.toMatchObject({
      exitCode: 2,
    });

    expect(deps.withRunResults).toHaveBeenCalledWith(expect.any(Function), [
      "run",
      "--select",
      "a",
    ]);
    expect(execute.mock.calls[0][2]).toEqual(expect.any(Function));
    await expect(closed).resolves.toBe(2);
  });

  it("rejects on a reported dbt error and fires onFailed", async () => {
    const deps = depsWith();
    const failed = vi.fn();
    deps.commandQueue.onFailed(failed);
    const terminal = new DbtTaskTerminal(() => undefined);

    await expect(
      enqueueCommand(
        deps,
        command("Encountered an error: x").command,
        terminal,
      ),
    ).rejects.toThrow("Encountered an error: x");
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("writes a waiting line while an earlier command runs", async () => {
    const deps = depsWith();
    let release!: () => void;
    void deps.commandQueue.enqueue(
      () => new Promise<void>((resolve) => (release = resolve)),
      { statusMessage: "first" },
    );
    const terminal = new DbtTaskTerminal(() => undefined);
    const { written } = recorded(terminal);

    const run = enqueueCommand(deps, command().command, terminal);

    expect(written).toEqual([
      "Waiting for the previous dbt command to finish…\r\n",
    ]);
    release();
    await run;
    expect(written[1]).toBe("> dbt run --select a\r\n");
  });

  it("skips a command whose terminal closed while it waited", async () => {
    const deps = depsWith();
    let release!: () => void;
    void deps.commandQueue.enqueue(
      () => new Promise<void>((resolve) => (release = resolve)),
      { statusMessage: "first" },
    );
    const { command: c, execute } = command();
    const terminal = new DbtTaskTerminal(() => undefined);

    const run = enqueueCommand(deps, c, terminal);
    terminal.close();
    release();

    await expect(run).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(deps.withRunResults).not.toHaveBeenCalled();
  });
});

describe("queueCli with a task terminal", () => {
  it("closes the terminal as failed when prepare throws", async () => {
    const terminal = new DbtTaskTerminal(() => undefined);
    const closed = new Promise((resolve) => terminal.onDidClose(resolve));
    const deps = {
      commandQueue: { enqueue: vi.fn() } as unknown as CommandQueue,
      cli: () =>
        ({
          prepare: () => {
            throw new Error("no dbt");
          },
        }) as unknown as FusionCli,
      snapshot: () =>
        ({
          invocation: { commandParams: { run: [] } },
        }) as unknown as ProjectSnapshot,
      withRunResults: (run: () => Promise<unknown>) => run(),
      notifyFailed: vi.fn(),
      terminal: { error: vi.fn() } as unknown as Log,
    } as unknown as ProjectCommandDeps;

    await expect(queueCli(deps, { kind: "deps" }, terminal)).rejects.toThrow();

    await expect(closed).resolves.toBe(1);
  });
});
