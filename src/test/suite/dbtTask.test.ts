import { describe, expect, it, vi } from "vitest";
import { CustomExecution, TaskRevealKind, tasks } from "vscode";
import { DBTCommand } from "../../core/dbtCommand";
import { CommandProcessResult } from "../../core/types";
import {
  cliCommandOf,
  DBT_TASK_TYPE,
  dbtTask,
  DbtTaskTerminal,
  definitionOf,
  executeTask,
  taskName,
} from "../../projects/dbtTask";

function commandThat(
  execute: (
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ) => Promise<Partial<CommandProcessResult>>,
): DBTCommand {
  const command = new DBTCommand("Running", ["run", "--select", "a"]);
  command.setExecutionStrategy({
    execute: (_c, signal, onOutput) =>
      execute(signal, onOutput) as Promise<CommandProcessResult>,
  });
  return command;
}

function recorded(terminal: DbtTaskTerminal) {
  const written: string[] = [];
  terminal.onDidWrite((text) => written.push(text));
  const closed = new Promise<number>((resolve) => terminal.onDidClose(resolve));
  return { written, closed };
}

describe("DbtTaskTerminal", () => {
  it("writes the command header, streams CRLF output, and closes with the exit code", async () => {
    const terminal = new DbtTaskTerminal(() => undefined);
    const { written, closed } = recorded(terminal);
    const result = { stdout: "a\nb", exitCode: 2 };

    await expect(
      terminal.run(
        commandThat(async (_signal, onOutput) => {
          onOutput?.("a\nb\r\n");
          return result;
        }),
      ),
    ).resolves.toBe(result);

    expect(written).toEqual(["> dbt run --select a\r\n", "a\r\nb\r\n"]);
    await expect(closed).resolves.toBe(2);
  });

  it("closes with 1 when the process ends without an exit code", async () => {
    const terminal = new DbtTaskTerminal(() => undefined);
    const { closed } = recorded(terminal);
    await terminal.run(commandThat(async () => ({ exitCode: null })));
    await expect(closed).resolves.toBe(1);
  });

  it("aborts a running process when Terminate Task closes the terminal, before the process exits", async () => {
    let signal: AbortSignal | undefined;
    let exit!: () => void;
    const command = commandThat(
      (s) =>
        new Promise((resolve) => {
          signal = s;
          exit = () => resolve({ exitCode: null });
        }),
    );
    const terminal = new DbtTaskTerminal(() => undefined);
    const { closed } = recorded(terminal);
    const run = terminal.run(command);
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);

    terminal.close();
    expect(signal?.aborted).toBe(true);

    exit();
    await run;
    await expect(closed).resolves.toBe(1);
  });

  it("aborts the process on the queue's signal", async () => {
    const signals: AbortSignal[] = [];
    const command = commandThat(async (signal) => {
      signals.push(signal!);
      return { exitCode: 0 };
    });
    const queue = new AbortController();
    await new DbtTaskTerminal(() => undefined).run(command, queue.signal);
    queue.abort();

    expect(signals.map((s) => s.aborted)).toEqual([true]);
  });

  it("writes a failure and closes with 1 when the command rejects", async () => {
    const terminal = new DbtTaskTerminal(() => undefined);
    const { written, closed } = recorded(terminal);
    await expect(
      terminal.run(commandThat(() => Promise.reject(new Error("no dbt")))),
    ).rejects.toThrow("no dbt");
    expect(written[written.length - 1]).toBe("Error: no dbt\r\n");
    await expect(closed).resolves.toBe(1);
  });

  it("calls start on open", () => {
    const start = vi.fn();
    const terminal = new DbtTaskTerminal(start);
    terminal.open();
    expect(start).toHaveBeenCalledWith(terminal);
  });
});

describe("dbt task definitions", () => {
  it.each([
    [{ kind: "run", select: "+a", fullRefresh: true }],
    [{ kind: "build" }],
    [{ kind: "test", select: "a" }],
    [{ kind: "compile" }],
    [{ kind: "deps" }],
  ] as const)("round-trips %o", (cli) => {
    const definition = definitionOf(cli, "/p");
    expect(definition).toMatchObject({
      type: DBT_TASK_TYPE,
      command: cli.kind,
      project: "/p",
    });
    expect(cliCommandOf(definition)).toEqual(
      expect.objectContaining({ kind: cli.kind }),
    );
    expect(cliCommandOf(definition)).toMatchObject(cli);
  });

  it("drops a false fullRefresh and ignores select on deps", () => {
    expect(
      cliCommandOf({ type: "dbt", command: "build", fullRefresh: false }),
    ).toEqual({ kind: "build", select: undefined, fullRefresh: undefined });
    expect(cliCommandOf({ type: "dbt", command: "deps", select: "a" })).toEqual(
      { kind: "deps" },
    );
  });

  it("rejects an unknown command", () => {
    expect(
      cliCommandOf({ type: "dbt", command: "seed" as never }),
    ).toBeUndefined();
  });

  it("names a task by subcommand and selection, adding the project only when there are several", () => {
    expect(taskName({ kind: "build" }, "jaffle", 1)).toBe("build");
    expect(taskName({ kind: "run", select: "+a" }, "jaffle", 2)).toBe(
      "run +a (jaffle)",
    );
  });

  it("reveals the terminal when focused and stays silent otherwise", () => {
    const execution = new CustomExecution(async () => undefined as never);
    const definition = definitionOf({ kind: "deps" }, "/p");
    expect(
      dbtTask(definition, "/p", "deps", execution, true).presentationOptions
        .reveal,
    ).toBe(TaskRevealKind.Always);
    const silent = dbtTask(definition, "/p", "deps", execution, false);
    expect(silent.presentationOptions.reveal).toBe(TaskRevealKind.Silent);
    expect([silent.name, silent.source]).toEqual(["deps", DBT_TASK_TYPE]);
  });
});

describe("executeTask", () => {
  function deps(onCreate?: (terminal: DbtTaskTerminal) => void) {
    let terminal: DbtTaskTerminal | undefined;
    const task = dbtTask(
      definitionOf({ kind: "deps" }, "/p"),
      "/p",
      "deps",
      new CustomExecution(async () => {
        terminal = new DbtTaskTerminal((t) => onCreate?.(t));
        return terminal;
      }),
    );
    return { task, terminal: () => terminal! };
  }

  it("resolves with an ended promise that settles once the task's terminal closes", async () => {
    const { task, terminal } = deps();
    const { ended } = await executeTask(task);
    let done = false;
    void ended.then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);

    terminal().fail("stopped");
    await ended;

    expect(tasks.executeTask).toHaveBeenCalledWith(task);
  });

  it("resolves ended when the task ended before executeTask returned", async () => {
    const { task } = deps((t) => t.fail("stopped"));
    const { ended } = await executeTask(task);
    await expect(ended).resolves.toBeUndefined();
  });

  it("runs a new execution after an active task with the same definition ends", async () => {
    const terminals: DbtTaskTerminal[] = [];
    const task = dbtTask(
      definitionOf({ kind: "deps" }, "/p"),
      "/p",
      "deps",
      new CustomExecution(async () => {
        const terminal = new DbtTaskTerminal(() => undefined);
        terminals.push(terminal);
        return terminal;
      }),
    );
    await executeTask(task);

    const second = executeTask(task);
    await new Promise((resolve) => setTimeout(resolve));
    expect(tasks.executeTask).toHaveBeenCalledTimes(1);

    terminals[0].fail("done");
    const { ended } = await second;
    expect(tasks.executeTask).toHaveBeenCalledTimes(2);
    expect(terminals).toHaveLength(2);

    terminals[1].fail("done");
    await expect(ended).resolves.toBeUndefined();
  });
});
