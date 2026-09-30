import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import * as fs from "fs";
import { Uri } from "vscode";
import { ProjectSnapshot } from "../../core/project";
import { DBTTerminal, RunModelType } from "../../dbt_integration";
import { FusionCli } from "../../fusion/fusionCli";
import { CommandQueue } from "../../projects/commandQueue";
import {
  formatCliStatus,
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
    jest
      .spyOn(fs.realpathSync, "native")
      .mockImplementation((value) => value as string);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
    jest
      .spyOn(fs.realpathSync, "native")
      .mockReturnValue("/elsewhere/customers.sql");

    expect(modelParamsFor(model).modelName).toBe("customers");
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
