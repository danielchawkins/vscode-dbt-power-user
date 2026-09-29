import { describe, expect, it, jest } from "@jest/globals";
import { ProjectSnapshot } from "../../core/project";
import { DBTTerminal } from "../../dbt_integration";
import { FusionCli } from "../../fusion/fusionCli";
import { CommandQueue } from "../../projects/commandQueue";
import {
  formatCliStatus,
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

describe("formatCliStatus", () => {
  it("formats a bare build without a selection", () => {
    expect(formatCliStatus({ kind: "build" }, [])).toBe("dbt build");
  });

  it("formats a selected command followed by its params", () => {
    const status = formatCliStatus({ kind: "run", select: "orders" }, [
      "--full-refresh",
    ]);
    expect(status).toBe("dbt run --select orders --full-refresh");
  });
});

describe("queueCli", () => {
  it("notifies failure and queues nothing when prepare throws", async () => {
    const enqueue = jest.fn();
    const notifyFailed = jest.fn();
    const error = jest.fn();
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
      terminal: { error } as unknown as DBTTerminal,
    };

    await queueCli(deps, { kind: "run", select: "orders" });

    expect(enqueue).not.toHaveBeenCalled();
    expect(notifyFailed).toHaveBeenCalledWith(
      "dbt run --select orders --full-refresh",
      "Error: no dbt",
    );
    expect(error).toHaveBeenCalledTimes(1);
  });
});
