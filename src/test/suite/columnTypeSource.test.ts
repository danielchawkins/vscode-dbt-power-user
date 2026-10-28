import { describe, expect, it, vi } from "vitest";
import type { DeferState } from "../../core/cli";
import type { TypeSourceProject } from "../../features/docs/columnTypeSource";
import { resolveColumnTypes } from "../../features/docs/columnTypeSource";
import { whyNotStrict } from "../../projects/registry/schemaOrigin";
import type { NeedsStrict } from "../../projects/registry/strictNeeded";
import { spyLog } from "../testLog";

const MODEL = { name: "orders", filePath: "/p/models/orders.sql" };
const RELATION = "db.s.orders";
const COLUMNS = [{ column: "id", dtype: "integer" }];

type Describe = (
  name: string,
  attempt: "target" | "deferred",
  signal?: AbortSignal,
) => Promise<unknown>;

/** A project whose CLI answers `describeModel` and reports `defer`, and whose language server is `state`. */
function fakeProject(options: {
  describeModel: Describe;
  defer?: DeferState;
  state?: string;
  getCurrentNode?: () => Promise<unknown>;
}) {
  const describeModel = vi.fn(options.describeModel);
  const getCurrentNode = vi.fn(
    options.getCurrentNode ?? (async () => undefined),
  );
  const project = {
    root: { fsPath: "/p" },
    lsp: { state: options.state ?? "running", getCurrentNode },
    getFusionCli: () => ({
      describeModel,
      deferState: () => options.defer ?? { kind: "default" },
    }),
  } as unknown as TypeSourceProject;
  return { project, describeModel, getCurrentNode };
}

const answer = (target: string, columns: unknown[] = COLUMNS) => ({
  target,
  relation: RELATION,
  columns,
});

const noStrictNeed = () => undefined;

describe("resolveColumnTypes: order", () => {
  it("asks target, then deferred, then inferred when nothing answers before", async () => {
    const { project, describeModel, getCurrentNode } = fakeProject({
      describeModel: async (_name, attempt) =>
        attempt === "target" ? answer("dev", []) : answer("prod", []),
      defer: { kind: "on", stateDirectory: "/state", favorState: false },
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(describeModel.mock.calls.map(([, attempt]) => attempt)).toEqual([
      "target",
      "deferred",
    ]);
    expect(getCurrentNode).toHaveBeenCalledTimes(1);
    expect(outcome.attempts.map(({ source }) => source)).toEqual([
      "target",
      "deferred",
      "inferred",
    ]);
    expect(outcome.attempts[0]).toEqual({
      source: "target",
      result: "missing",
      target: "dev",
      relation: RELATION,
    });
    expect(outcome.answered).toBeUndefined();
  });

  it("stops at the first source that answers", async () => {
    const { project, describeModel, getCurrentNode } = fakeProject({
      describeModel: async () => answer("dev"),
      defer: { kind: "on", stateDirectory: "/state", favorState: false },
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(describeModel).toHaveBeenCalledTimes(1);
    expect(getCurrentNode).not.toHaveBeenCalled();
    expect(outcome.answered).toEqual({
      source: "target",
      target: "dev",
      relation: RELATION,
      columns: COLUMNS,
    });
  });
});

describe("resolveColumnTypes: deferred", () => {
  it.each([
    ["default", { kind: "default" }],
    ["off", { kind: "off" }],
    ["unset", { kind: "unset" }],
  ] as const)(
    "skips the deferred attempt unless defer is on (%s)",
    async (_label, defer) => {
      const { project, describeModel } = fakeProject({
        describeModel: async () => answer("dev", []),
        defer,
      });

      const outcome = await resolveColumnTypes(project, MODEL, {
        log: spyLog(),
        columnsNeedStrict: noStrictNeed,
      });

      expect(describeModel.mock.calls.map(([, attempt]) => attempt)).toEqual([
        "target",
      ]);
      expect(outcome.attempts[1]).toEqual({
        source: "deferred",
        result: "notConfigured",
        detail: defer.kind,
      });
    },
  );

  it("names the unusable state path it could not use", async () => {
    const { project, describeModel } = fakeProject({
      describeModel: async () => answer("dev", []),
      defer: { kind: "unusable", manifestPath: "/state/x.txt" },
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(describeModel).toHaveBeenCalledTimes(1);
    expect(outcome.attempts[1]).toEqual({
      source: "deferred",
      result: "notConfigured",
      detail: "unusable",
      state: "/state/x.txt",
    });
  });

  it("answers from the state directory, and the source names the relation and that directory", async () => {
    const { project } = fakeProject({
      describeModel: async (_name, attempt) =>
        attempt === "target" ? answer("dev", []) : answer("prod"),
      defer: { kind: "on", stateDirectory: "/work/state", favorState: true },
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(outcome.answered?.source).toBe("deferred");
    expect(outcome.answered?.relation).toBe(RELATION);
    expect(outcome.answered?.state).toBe("/work/state");
  });
});

describe("resolveColumnTypes: failures", () => {
  it("records a thrown attempt as failed, logs the error, and goes on", async () => {
    const error = new Error("boom\n  at stack");
    const log = spyLog();
    const { project, describeModel } = fakeProject({
      describeModel: async (_name, attempt) => {
        if (attempt === "target") {
          throw error;
        }
        return answer("prod");
      },
      defer: { kind: "on", stateDirectory: "/state", favorState: false },
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log,
      columnsNeedStrict: noStrictNeed,
    });

    expect(describeModel).toHaveBeenCalledTimes(2);
    expect(outcome.attempts[0]).toEqual({
      source: "target",
      result: "failed",
      detail: "boom\n  at stack",
    });
    expect(outcome.answered?.source).toBe("deferred");
    expect(log.error).toHaveBeenCalledWith(
      "Docs",
      expect.stringContaining("target"),
      error,
    );
  });

  it("records a thrown inferred attempt as failed", async () => {
    const { project } = fakeProject({
      describeModel: async () => answer("dev", []),
      getCurrentNode: async () => {
        throw new Error("lsp went away");
      },
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(outcome.attempts.at(-1)).toEqual({
      source: "inferred",
      result: "failed",
      detail: "lsp went away",
    });
  });

  it("rethrows an abort rather than recording it as a failure", async () => {
    const controller = new AbortController();
    const { project } = fakeProject({
      describeModel: async (_name, _attempt, signal) => {
        controller.abort();
        signal?.throwIfAborted();
        return answer("dev");
      },
    });

    await expect(
      resolveColumnTypes(project, MODEL, {
        log: spyLog(),
        columnsNeedStrict: noStrictNeed,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe("resolveColumnTypes: inferred reasons", () => {
  const missing = async () => answer("dev", []);

  it("says static analysis is not strict, and why, when the mode computes no columns", async () => {
    const needs: NeedsStrict = { mode: "baseline", setting: "project" };
    const { project } = fakeProject({ describeModel: missing });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: () => needs,
    });

    expect(outcome.attempts.at(-1)).toEqual({
      source: "inferred",
      result: "unavailable",
      detail: `static analysis is baseline, not strict: ${whyNotStrict("project")}`,
    });
  });

  it("says the language server is not running, without asking it", async () => {
    const { project, getCurrentNode } = fakeProject({
      describeModel: missing,
      state: "stopped",
    });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(getCurrentNode).not.toHaveBeenCalled();
    expect(outcome.attempts.at(-1)).toEqual({
      source: "inferred",
      result: "unavailable",
      detail: "the Fusion language server is not running",
    });
  });

  it("says the server has no columns for the model when it is running and returns none", async () => {
    const { project } = fakeProject({ describeModel: missing });

    const outcome = await resolveColumnTypes(project, MODEL, {
      log: spyLog(),
      columnsNeedStrict: noStrictNeed,
    });

    expect(outcome.attempts.at(-1)).toEqual({
      source: "inferred",
      result: "unavailable",
      detail: "the language server has no columns for `orders`",
    });
  });
});
