import { beforeEach, describe, expect, it, vi } from "vitest";
import { Uri, window } from "vscode";
import { columnLineageArgs } from "../../core/lineage/columnLineage";
import type { NodeMetaMap, SourceMetaMap } from "../../core/manifest/types";
import type { ProposalTarget } from "../../features/docs/columnProposals";
import {
  ColumnProposalRequests,
  ColumnProposalService,
} from "../../features/docs/columnProposals";
import type { TypeSourceProject } from "../../features/docs/columnTypeSource";
import { spyLog } from "../testLog";

const MODEL = { name: "orders", filePath: "/p/models/orders.sql" };
const COLUMNS = [{ column: "id", dtype: "varchar" }];
const ORDER_TOTALS = "model.lineage.order_totals";
const ORDER_TOTAL = `${ORDER_TOTALS}.total`;
const GRAND_TOTALS = "model.lineage.grand_totals";
const GRAND_TOTAL = `${GRAND_TOTALS}.grand_total`;

/** The manifest of the descriptions test: `order_totals.total` is described, nothing else is. */
const MANIFEST = {
  nodeMetaMap: {
    lookupByUniqueId: (id: string) =>
      id === ORDER_TOTALS
        ? { columns: { total: { description: "Order total" } } }
        : undefined,
  } as unknown as NodeMetaMap,
  sourceMetaMap: new Map() as SourceMetaMap,
};

/** The node metadata of a manifest with no described node. */
const UNDESCRIBED_NODES = {
  lookupByUniqueId: () => undefined,
} as unknown as NodeMetaMap;

interface FakeToken {
  isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
  cancel(): void;
}

/** A cancellation token the test cancels by hand. */
function fakeToken(): FakeToken {
  const listeners: (() => void)[] = [];
  return {
    isCancellationRequested: false,
    onCancellationRequested(listener) {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
    cancel() {
      this.isCancellationRequested = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/** A project whose CLI answers `describeModel` with `describeModel`, and whose defer is off. The language server answers `currentNode`. */
function fakeProject(
  describeModel: (...args: unknown[]) => unknown,
  currentNode?: unknown,
) {
  const spy = vi.fn(describeModel);
  const project = {
    projectRoot: { fsPath: "/p" },
    lsp: {
      state: "running",
      getCurrentNode: vi.fn(async () => currentNode),
    },
    getFusionCli: () => ({
      describeModel: spy,
      deferState: () => ({ kind: "off" }),
    }),
  } as unknown as TypeSourceProject;
  return { project, describeModel: spy };
}

const target = (
  project: TypeSourceProject,
  overrides: Partial<ProposalTarget> = {},
): ProposalTarget => ({
  model: MODEL,
  yaml: [{ name: "id", type: "integer" }],
  described: [],
  project,
  ...overrides,
});

const answer = { target: "dev", relation: "db.s.orders", columns: COLUMNS };

describe("ColumnProposalService", () => {
  let token: FakeToken;

  beforeEach(() => {
    token = fakeToken();
    vi.mocked(window.withProgress).mockImplementation(((
      _options: unknown,
      task: (...args: unknown[]) => unknown,
    ) => task({ report: vi.fn() }, token)) as never);
  });

  it("proposes from the draft over the YAML", async () => {
    const { project } = fakeProject(async () => answer);
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const withDraft = await service.propose(
      "types",
      target(project, { draft: [{ name: "id", type: "varchar" }] }),
    );
    expect(withDraft?.proposals).toEqual([]);
    expect(withDraft?.model).toBe(MODEL.filePath);
    expect(withDraft?.source).toEqual({
      kind: "target",
      target: "dev",
      relation: "db.s.orders",
    });

    const yamlOnly = await service.propose("types", target(project));
    expect(yamlOnly?.proposals).toEqual([
      {
        column: "id",
        type: "varchar",
        change: "overwrite",
        current: "integer",
      },
    ]);
  });

  it("drops a superseded request's result, even when it finishes later", async () => {
    let release!: (value: typeof answer) => void;
    const slow = new Promise<typeof answer>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const { project, describeModel } = fakeProject(() =>
      ++calls === 1 ? slow : Promise.resolve(answer),
    );
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const older = service.propose("types", target(project));
    const newer = service.propose("types", target(project));
    release(answer);

    expect(await older).toBeUndefined();
    expect((await newer)?.source?.kind).toBe("target");
    expect(describeModel).toHaveBeenCalledTimes(2);
  });

  it("resolves undefined when the user cancels the progress", async () => {
    const { project, describeModel } = fakeProject(
      (_name: unknown, _attempt: unknown, signal: unknown) =>
        new Promise((_resolve, reject) => {
          (signal as AbortSignal).addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const pending = service.propose("types", target(project));
    await vi.waitFor(() => expect(describeModel).toHaveBeenCalled());
    token.cancel();

    expect(await pending).toBeUndefined();
    expect(window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({ cancellable: true }),
      expect.any(Function),
    );
  });

  it("names the deferred relation and its state in the source", async () => {
    const project = {
      projectRoot: { fsPath: "/p" },
      lsp: { state: "running", getCurrentNode: vi.fn(async () => undefined) },
      getFusionCli: () => ({
        describeModel: vi.fn(async (_name: unknown, attempt: unknown) =>
          attempt === "target"
            ? { target: "dev", relation: "db.s.orders", columns: [] }
            : { target: "prod", relation: "db.s.orders", columns: COLUMNS },
        ),
        deferState: () => ({
          kind: "on",
          stateDirectory: "/work/state",
          favorState: true,
        }),
      }),
    } as unknown as TypeSourceProject;
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose("types", target(project));

    expect(payload?.source).toEqual({
      kind: "deferred",
      target: "prod",
      relation: "db.s.orders",
      state: "/work/state",
    });
    expect(payload?.notice).toBeUndefined();
  });

  it("warns with the inferred types when no warehouse source answered", async () => {
    const { project } = fakeProject(
      async () => ({ target: "dev", relation: "db.s.orders", columns: [] }),
      { node: { columns: { id: { data_type: "INTEGER" } } } },
    );
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose("types", target(project));

    expect(payload?.source).toEqual({ kind: "inferred" });
    expect(payload?.notice?.type).toBe("warning");
    expect(payload?.notice?.actions).toBeUndefined();
  });

  it("errors when nothing answered and the strict action is offered only when static analysis needs it", async () => {
    const missing = async () => ({
      target: "dev",
      relation: "db.s.orders",
      columns: [],
    });
    const plain = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });
    const { project } = fakeProject(missing);

    const withoutStrict = await plain.propose("types", target(project));
    expect(withoutStrict?.notice?.type).toBe("error");
    expect(withoutStrict?.notice?.message).toContain("is not built");
    expect(withoutStrict?.notice?.actions).toBeUndefined();

    const strict = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => ({ mode: "off", setting: "strict" }),
    });
    const withStrict = await strict.propose("types", target(project));
    expect(withStrict?.notice?.type).toBe("error");
    expect(withStrict?.notice?.actions).toEqual([
      { title: "Use strict analysis", action: "useStrictAnalysis" },
    ]);
  });
});

/** A `dbt.listNodes` column result: `grand_total` is a copy of `order_totals.total`. */
const LINEAGE = {
  nodes: [
    {
      unique_id: GRAND_TOTAL,
      name: "grand_total",
      op: "copy",
      parents: [ORDER_TOTAL],
    },
  ],
};

/** A project whose language server answers `listNodes` with `answer` (`LINEAGE` by default), in the given state. */
function describingProject(
  state: "running" | "stopped" = "running",
  answer: () => Promise<unknown> = async () => LINEAGE,
) {
  const listNodes = vi.fn(answer);
  const project = {
    projectRoot: { fsPath: "/p" },
    lsp: { state, getCurrentNode: vi.fn(async () => undefined), listNodes },
    getFusionCli: () => ({
      describeModel: vi.fn(),
      deferState: () => ({ kind: "off" }),
    }),
  } as unknown as TypeSourceProject;
  return { project, listNodes };
}

/** A target for the descriptions of `grand_total`, a model whose manifest describes `order_totals.total`. */
const describedTarget = (
  project: TypeSourceProject,
  overrides: Partial<ProposalTarget> = {},
): ProposalTarget =>
  target(project, {
    described: [{ name: "grand_total", description: "" }],
    node: { uniqueId: GRAND_TOTALS, manifest: MANIFEST },
    ...overrides,
  });

describe("ColumnProposalService descriptions", () => {
  beforeEach(() => {
    vi.mocked(window.withProgress).mockImplementation(((
      _options: unknown,
      task: (...args: unknown[]) => unknown,
    ) => task({ report: vi.fn() }, fakeToken())) as never);
  });

  it("proposes the first described copy ancestor's description for each column without one", async () => {
    const { project, listNodes } = describingProject();
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project),
    );

    expect(listNodes).toHaveBeenCalledWith(
      columnLineageArgs(GRAND_TOTALS, "grand_total"),
    );
    expect(payload).toEqual({
      kind: "descriptions",
      model: MODEL.filePath,
      proposals: [
        {
          column: "grand_total",
          candidates: [
            {
              description: "Order total",
              sources: [{ uniqueId: ORDER_TOTALS, column: "total" }],
            },
          ],
        },
      ],
    });
  });

  it("reports a failed request as an error, logs it, and proposes nothing when no earlier column answered", async () => {
    const failure = new Error("listNodes timed out");
    const { project } = describingProject("running", async () => {
      throw failure;
    });
    const log = spyLog();
    const service = new ColumnProposalService({
      log,
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project),
    );

    expect(payload?.proposals).toEqual([]);
    expect(payload?.notice?.type).toBe("error");
    expect(payload?.notice?.message).toContain("listNodes timed out");
    expect(log.error).toHaveBeenCalledWith(
      "Docs",
      expect.stringContaining("upstream descriptions failed"),
      failure,
    );
  });

  it("keeps the proposals found before a failed request, with the error notice", async () => {
    let calls = 0;
    const { project } = describingProject("running", async () => {
      calls += 1;
      if (calls === 1) {
        return LINEAGE;
      }
      throw new Error("listNodes timed out");
    });
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project, {
        described: [
          { name: "grand_total", description: "" },
          { name: "other", description: "" },
        ],
      }),
    );

    expect(payload?.proposals).toEqual([
      {
        column: "grand_total",
        candidates: [
          {
            description: "Order total",
            sources: [{ uniqueId: ORDER_TOTALS, column: "total" }],
          },
        ],
      },
    ]);
    expect(payload?.notice?.type).toBe("error");
    expect(payload?.notice?.message).toContain("listNodes timed out");
  });

  it("shows no notice when every column already has a description", async () => {
    const { project, listNodes } = describingProject();
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project, {
        described: [{ name: "grand_total", description: "Already set" }],
      }),
    );

    expect(listNodes).not.toHaveBeenCalled();
    expect(payload).toEqual({
      kind: "descriptions",
      model: MODEL.filePath,
      proposals: [],
    });
  });

  it("warns when no copy ancestor has a description", async () => {
    const { project, listNodes } = describingProject();
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project, {
        node: {
          uniqueId: GRAND_TOTALS,
          manifest: { ...MANIFEST, nodeMetaMap: UNDESCRIBED_NODES },
        },
      }),
    );

    expect(listNodes).toHaveBeenCalled();
    expect(payload).toEqual({
      kind: "descriptions",
      model: MODEL.filePath,
      proposals: [],
      notice: {
        message:
          "No upstream copy has a description for the columns without one.",
        type: "warning",
      },
    });
  });

  it("reports a stopped language server as an error and asks it nothing", async () => {
    const { project, listNodes } = describingProject("stopped");
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project),
    );

    expect(listNodes).not.toHaveBeenCalled();
    expect(payload?.proposals).toEqual([]);
    expect(payload?.notice?.type).toBe("error");
    expect(payload?.notice?.message).toContain("it is stopped");
  });

  it("offers the strict action and asks nothing when the mode computes no column lineage", async () => {
    const { project, listNodes } = describingProject();
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => ({ mode: "off", setting: "strict" }),
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project),
    );

    expect(listNodes).not.toHaveBeenCalled();
    expect(payload?.proposals).toEqual([]);
    expect(payload?.notice?.type).toBe("warning");
    expect(payload?.notice?.message).toMatch(
      /^Proposing upstream descriptions needs strict static analysis, but this project runs off\./,
    );
    expect(payload?.notice?.actions).toEqual([
      { title: "Use strict analysis", action: "useStrictAnalysis" },
    ]);
  });

  it("reports a model whose metadata has not loaded as an error and asks nothing", async () => {
    const { project, listNodes } = describingProject();
    const service = new ColumnProposalService({
      log: spyLog(),
      columnsNeedStrict: () => undefined,
    });

    const payload = await service.propose(
      "descriptions",
      describedTarget(project, { node: undefined }),
    );

    expect(listNodes).not.toHaveBeenCalled();
    expect(payload?.proposals).toEqual([]);
    expect(payload?.notice?.type).toBe("error");
    expect(payload?.notice?.message).toContain("has not loaded yet");
  });
});

describe("ColumnProposalRequests", () => {
  it("fires { kind, uri } to its listeners", () => {
    const requests = new ColumnProposalRequests();
    const listener = vi.fn();
    requests.onDidRequest(listener);
    const uri = Uri.file("/p/models/orders.sql");
    requests.request("types", uri);
    expect(listener).toHaveBeenCalledWith({ kind: "types", uri });
    requests.dispose();
  });
});
