import { describe, expect, it, vi } from "vitest";
import type { CliCommand } from "../../core/cli";
import type { Log } from "../../core/log";
import type { CommandProcessResult } from "../../core/types";
import {
  type ExclusionSources,
  LineageExclusions,
} from "../../features/lineage/lineageExclusion";
import type { Manifest } from "../../projects/manifest/manifestTypes";

const RULE = "resource_type:function resource_type:macro";

/** Two manifests as distinct objects: a re-parse hands out a new one. */
const first = { publicationEpoch: 1 } as unknown as Manifest;
const second = { publicationEpoch: 2 } as unknown as Manifest;

const log = { warn: vi.fn() } as unknown as Log & {
  warn: ReturnType<typeof vi.fn>;
};

function lsStdout(...ids: string[]): string {
  return [
    "       dbt 2.0.6",
    "=======================Selected nodes=======================",
    ...ids.map((id) => JSON.stringify({ unique_id: id })),
    "Finished 'list' successfully",
  ].join("\n");
}

function cliAnswer(result: Partial<CommandProcessResult>) {
  return vi.fn(async (_command: CliCommand): Promise<CommandProcessResult> => ({
    stdout: "",
    stderr: "",
    fullOutput: "",
    exitCode: 0,
    ...result,
  }));
}

/** A server that answers `dbt.listNodes` with `nodes`, or a `server` that is not running. */
function serverAnswer(nodes: unknown[]) {
  return {
    listNodes: vi.fn(async (_selectors: readonly string[]) => ({ nodes })),
  };
}

function resolverWith(
  overrides: Partial<{
    server: ExclusionSources["server"];
    cli: ReturnType<typeof cliAnswer>;
  }>,
) {
  const run = overrides.cli ?? cliAnswer({ stdout: lsStdout() });
  const sources: ExclusionSources = {
    server: overrides.server ?? (() => undefined),
    cli: () => ({ run }),
    log,
  };
  return { exclusions: new LineageExclusions(sources), run };
}

describe("LineageExclusions", () => {
  it("answers from dbt.listNodes while the server runs, and leaves dbt ls alone", async () => {
    const server = serverAnswer([
      { unique_id: "function.shop.normalize_timestamp" },
      { unique_id: "macro.shop.cents" },
      { name: "no id" },
    ]);
    const { exclusions, run } = resolverWith({ server: () => server });

    const [outcome] = await exclusions.resolveRules(first, [RULE]);

    expect(outcome).toEqual({
      rule: RULE,
      ids: ["function.shop.normalize_timestamp", "macro.shop.cents"],
    });
    expect(server.listNodes).toHaveBeenCalledWith([RULE], { purpose: "graph" });
    expect(run).not.toHaveBeenCalled();
  });

  it("asks dbt ls with the rule when the server is not running", async () => {
    const run = cliAnswer({ stdout: lsStdout("function.shop.f") });
    const { exclusions } = resolverWith({ cli: run });

    const [outcome] = await exclusions.resolveRules(first, [RULE]);

    expect(outcome).toEqual({ rule: RULE, ids: ["function.shop.f"] });
    expect(run).toHaveBeenCalledWith({ kind: "ls", select: RULE });
  });

  it("falls back to dbt ls, and logs why, when dbt.listNodes fails", async () => {
    const server = {
      listNodes: vi.fn(async () => {
        throw new Error("Operation timed out");
      }),
    };
    const run = cliAnswer({ stdout: lsStdout("function.shop.f") });
    const { exclusions } = resolverWith({ server: () => server, cli: run });

    const [outcome] = await exclusions.resolveRules(first, [RULE]);

    expect(outcome).toEqual({ rule: RULE, ids: ["function.shop.f"] });
    expect(run).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      "Lineage:exclusion",
      expect.stringContaining("Operation timed out"),
    );
  });

  it("reports a failed dbt ls as the rule's failure, and asks again on the next request", async () => {
    const run = cliAnswer({
      exitCode: 2,
      stderr: "[error] unknown selector\n",
    });
    const { exclusions } = resolverWith({ cli: run });

    const [failed] = await exclusions.resolveRules(first, [RULE]);
    expect(failed).toEqual({ rule: RULE, failure: "unknown selector" });

    run.mockResolvedValueOnce({
      stdout: lsStdout("function.shop.f"),
      stderr: "",
      fullOutput: "",
      exitCode: 0,
    });
    const [retried] = await exclusions.resolveRules(first, [RULE]);
    expect(retried).toEqual({ rule: RULE, ids: ["function.shop.f"] });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps one answer per manifest and rule, and asks again for a new manifest", async () => {
    const server = serverAnswer([{ unique_id: "function.shop.f" }]);
    const { exclusions } = resolverWith({ server: () => server });

    await exclusions.resolveRules(first, [RULE]);
    await exclusions.resolveRules(first, [RULE]);
    expect(server.listNodes).toHaveBeenCalledTimes(1);

    await exclusions.resolveRules(second, [RULE]);
    expect(server.listNodes).toHaveBeenCalledTimes(2);
  });

  it("keeps the answers of the other rules when one rule fails", async () => {
    const server = {
      listNodes: vi.fn(async (selectors: readonly string[]) => {
        if (selectors[0] === "bad") {
          throw new Error("server refused");
        }
        return { nodes: [{ unique_id: "function.shop.f" }] };
      }),
    };
    // The server's failure falls back to dbt ls, which also rejects the bad selector.
    const run = cliAnswer({ stdout: lsStdout("function.shop.f") });
    run.mockImplementation(async (command: CliCommand) =>
      command.kind === "ls" && command.select === "bad"
        ? {
            stdout: "",
            stderr: "[error] bad selector",
            fullOutput: "",
            exitCode: 1,
          }
        : {
            stdout: lsStdout("function.shop.f"),
            stderr: "",
            fullOutput: "",
            exitCode: 0,
          },
    );
    const { exclusions } = resolverWith({ server: () => server, cli: run });

    const outcomes = await exclusions.resolveRules(first, ["bad", RULE]);

    expect(outcomes).toEqual([
      { rule: "bad", failure: "bad selector" },
      { rule: RULE, ids: ["function.shop.f"] },
    ]);
  });

  it("treats a rule that selects no node as an empty answer, not a failure", async () => {
    // Fusion 2.0.6 lists no macros for `resource_type:macro`; see docs/lsp-metadata-gaps.md.
    const server = serverAnswer([]);
    const { exclusions } = resolverWith({ server: () => server });

    const outcomes = await exclusions.resolveRules(first, [
      "resource_type:macro",
    ]);

    expect(outcomes).toEqual([{ rule: "resource_type:macro", ids: [] }]);
  });
});
