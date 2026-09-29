import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import fc from "fast-check";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DBTTerminal, RunResultsEventData } from "../../dbt_integration";
import {
  parseRunResultsJson,
  resolveRunStatus,
  RunResultsReader,
  withRunResults,
} from "../../projects/runResults";

function mockTerminal(): DBTTerminal {
  return {
    debug: () => undefined,
    error: () => undefined,
    trace: () => undefined,
  } as unknown as DBTTerminal;
}

function sampleRunResultsJson(invocationId = "inv-123") {
  return JSON.stringify({
    metadata: {
      invocation_id: invocationId,
      generated_at: "2026-01-01T00:00:00.000000Z",
    },
    args: { which: "run", select: ["my_model"] },
    results: [
      {
        unique_id: "model.single_project.my_model",
        status: "success",
        execution_time: 1.2,
      },
    ],
    elapsed_time: 1.2,
  });
}

describe("parseRunResultsJson", () => {
  it("builds the command string and results from run_results.json", () => {
    const event = parseRunResultsJson(
      {
        metadata: {
          invocation_id: "inv",
          generated_at: "2026-01-01T00:00:00Z",
        },
        args: {
          which: "build",
          select: "a",
          exclude: ["b", "c"],
          full_refresh: true,
          target: "dev",
        },
        results: [{ unique_id: "test.p.t1", status: "fail" }],
      },
      "p",
    );
    expect(event.command).toBe(
      "dbt build --select a --exclude b c --full-refresh --target dev",
    );
    expect(event.args).toEqual(["a"]);
    expect(event.results).toEqual([
      expect.objectContaining({
        name: "t1",
        status: "error",
        resourceType: "test",
        executionTime: null,
      }),
    ]);
    expect(event.elapsedTime).toBe(0);
  });

  it("throws when required fields are missing", () => {
    expect(() => parseRunResultsJson({ args: { which: "run" } }, "p")).toThrow(
      /Malformed run_results.json/,
    );
  });
});

describe("resolveRunStatus", () => {
  it.each([
    ["success", "success"],
    ["pass", "success"],
    ["error", "error"],
    ["fail", "error"],
    ["warn", "warn"],
    ["skipped", "skipped"],
    ["other", "skipped"],
  ])("maps %s to %s", (status, expected) => {
    expect(resolveRunStatus(status)).toBe(expected);
  });
});

describe("RunResultsReader", () => {
  let tempRoot: string;
  let targetDir: string;
  let reader: RunResultsReader;

  const write = (content: string) =>
    fs.writeFileSync(path.join(targetDir, "run_results.json"), content);

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "run-results-"));
    targetDir = path.join(tempRoot, "target");
    fs.mkdirSync(targetDir);
    reader = new RunResultsReader(
      () => targetDir,
      () => "single_project",
      mockTerminal(),
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("parses run_results.json when content appears after command start", () => {
    const before = reader.observe();
    write(sampleRunResultsJson());
    const event = reader.readIfChanged(before);

    expect(before).toBeNull();
    expect(event).toEqual(
      expect.objectContaining({ id: "inv-123", projectName: "single_project" }),
    );
  });

  it("ignores unchanged run_results.json after command start", () => {
    write(sampleRunResultsJson());
    expect(reader.readIfChanged(reader.observe())).toBeNull();
  });

  it("stays silent when run_results.json is missing after command start", () => {
    expect(reader.readIfChanged(reader.observe())).toBeNull();
  });

  it("parses run_results.json when content changes after command start", () => {
    write(sampleRunResultsJson("inv-old"));
    const before = reader.observe();
    write(sampleRunResultsJson("inv-new"));
    expect(reader.readIfChanged(before)?.id).toBe("inv-new");
  });

  it("observes nothing without a target path", () => {
    const noTarget = new RunResultsReader(
      () => undefined,
      () => "p",
      mockTerminal(),
    );
    expect(noTarget.observe()).toBeNull();
  });

  it("returns null iff the content is unchanged or absent", () => {
    const content = fc.option(
      fc.constantFrom("inv-a", "inv-b", "inv-c").map(sampleRunResultsJson),
      { nil: undefined },
    );
    const file = path.join(targetDir, "run_results.json");
    const place = (value: string | undefined) =>
      value === undefined ? fs.rmSync(file, { force: true }) : write(value);
    fc.assert(
      fc.property(content, content, (before, after) => {
        place(before);
        const observed = reader.observe();
        place(after);
        const unchangedOrAbsent = after === undefined || after === before;
        expect(reader.readIfChanged(observed) === null).toBe(unchangedOrAbsent);
      }),
    );
  });
});

describe("withRunResults", () => {
  const entry = { id: "inv" } as RunResultsEventData;

  function stubReader(changed: RunResultsEventData | null) {
    return {
      observe: jest.fn(() => "before"),
      readIfChanged: jest.fn(() => changed),
    } as unknown as RunResultsReader & {
      readIfChanged: jest.Mock;
    };
  }

  it("records the run a command wrote and returns its result", async () => {
    const reader = stubReader(entry);
    const history = { addEntry: jest.fn() };
    await expect(
      withRunResults(reader, history, async () => "done"),
    ).resolves.toBe("done");
    expect(reader.readIfChanged).toHaveBeenCalledWith("before");
    expect(history.addEntry).toHaveBeenCalledWith(entry);
  });

  it("records nothing when run_results.json did not change", async () => {
    const history = { addEntry: jest.fn() };
    await withRunResults(stubReader(null), history, async () => undefined);
    expect(history.addEntry).not.toHaveBeenCalled();
  });

  it("records nothing when the command rejects", async () => {
    const reader = stubReader(entry);
    const history = { addEntry: jest.fn() };
    await expect(
      withRunResults(reader, history, () => Promise.reject(new Error("x"))),
    ).rejects.toThrow("x");
    expect(reader.readIfChanged).not.toHaveBeenCalled();
    expect(history.addEntry).not.toHaveBeenCalled();
  });
});
