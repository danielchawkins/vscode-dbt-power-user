import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, window } from "vscode";
import { DocsDrafts } from "../../features/docs/docsDrafts";
import type { DocsHarnessDeps } from "../../features/docs/docsHarnessCommands";
import { registerDocsHarnessCommands } from "../../features/docs/docsHarnessCommands";

const FILE = "/p/models/orders.sql";
const ACCEPT_ALL_COMMAND = "fusionPowerUser.test.acceptAllColumnProposals";
const YAML_TESTS = [{ name: "not_null_orders_id" }];
const DRAFT_TESTS = [{ name: "unique_orders_id" }];

/** Stubs for accept-all with one unticked overwrite (customer_id) and one add (order_count). */
function harness({ draft }: { draft?: boolean } = {}) {
  const documentation = {
    name: "orders",
    filePath: FILE,
    columns: [{ name: "customer_id", type: "varchar" }],
  };
  const payload = {
    kind: "types" as const,
    model: FILE,
    proposals: [
      {
        column: "customer_id",
        type: "integer",
        change: "overwrite" as const,
        current: "varchar",
      },
      { column: "order_count", type: "bigint", change: "add" as const },
    ],
    notFound: [],
  };
  const drafts = new DocsDrafts();
  if (draft) {
    drafts.set(FILE, {
      docs: {
        ...documentation,
        columns: [{ name: "customer_id", type: "varchar" }],
      },
      tests: DRAFT_TESTS as never,
    });
  }
  const deps = {
    columnProposals: { propose: vi.fn(async () => payload) },
    docGenService: {
      getUncompiledDocumentationForCurrentActiveFile: vi.fn(async () => ({
        documentation,
      })),
    },
    dbtTestService: {
      getTestsForCurrentModel: vi.fn(async () => YAML_TESTS),
    },
    drafts,
    proposalTarget: vi.fn(async () => ({})),
    save: vi.fn(async (_message: unknown) => undefined),
  };
  return { deps, save: deps.save };
}

/** Runs the registered accept-all command for the model file, the way the integration harness does. */
async function runAcceptAll(deps: ReturnType<typeof harness>["deps"]) {
  vi.mocked(commands.registerCommand).mockClear();
  const registered = registerDocsHarnessCommands(
    deps as unknown as DocsHarnessDeps,
  );
  expect(registered).toHaveLength(2);
  const call = vi
    .mocked(commands.registerCommand)
    .mock.calls.find(([id]) => id === ACCEPT_ALL_COMMAND);
  expect(call, `${ACCEPT_ALL_COMMAND} is registered`).toBeDefined();
  const handler = call![1] as (kind: string, file: string) => Promise<unknown>;
  return handler("types", FILE);
}

describe("accept-all through the registered docs harness command", () => {
  beforeEach(() => {
    process.env.FPU_INTEGRATION_COMMANDS = "1";
    (window as any).showTextDocument = vi.fn(async () => undefined);
  });

  afterEach(() => {
    delete process.env.FPU_INTEGRATION_COMMANDS;
  });

  it("saves the model's tests from the YAML when there is no draft", async () => {
    const { deps, save } = harness();

    const outcome = await runAcceptAll(deps);

    expect(outcome).toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      command: "saveDocumentation",
      updatedTests: YAML_TESTS,
    });
  });

  it("saves the draft's tests when there is a draft", async () => {
    const { deps, save } = harness({ draft: true });

    await runAcceptAll(deps);

    expect(save.mock.calls[0][0]).toMatchObject({ updatedTests: DRAFT_TESTS });
  });

  it("leaves an unticked overwrite pending, so the saved type is the YAML's", async () => {
    const { deps, save } = harness();

    await runAcceptAll(deps);

    expect(save.mock.calls[0][0]).toMatchObject({
      columns: [
        { name: "customer_id", type: "varchar" },
        { name: "order_count", type: "bigint", source: "DATABASE" },
      ],
    });
  });

  it("reports noDocumentation and saves nothing when the active file has no documentation", async () => {
    const { deps, save } = harness();
    deps.docGenService.getUncompiledDocumentationForCurrentActiveFile = vi.fn(
      async () => ({ documentation: undefined }),
    ) as never;

    const outcome = await runAcceptAll(deps);

    expect(outcome).toBe("noDocumentation");
    expect(save).not.toHaveBeenCalled();
  });

  it("reports noPayload and saves nothing when no proposals answer", async () => {
    const { deps, save } = harness();
    deps.columnProposals.propose = vi.fn(async () => undefined) as never;

    const outcome = await runAcceptAll(deps);

    expect(outcome).toBe("noPayload");
    expect(save).not.toHaveBeenCalled();
  });
});
