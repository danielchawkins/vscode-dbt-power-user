import { firstLogLine, lsUniqueIds } from "../../core/cli";
import type { Log } from "../../core/log";
import type { FusionCli } from "../../fusion/fusionCli";
import type { FusionCommands } from "../../fusion/fusionCommands";
import type { Manifest } from "../../projects/manifest/manifestTypes";

const LOG_SOURCE = "Lineage:exclusion";

/** What one exclusion rule selects in a manifest: its unique IDs, or why dbt could not say. */
export type RuleResolution =
  | { rule: string; ids: readonly string[] }
  | { rule: string; failure: string };

/** Where a rule is answered: the language server while its client runs, and the dbt CLI otherwise. */
export interface ExclusionSources {
  /** The Current Project's server commands, when its client is running; `undefined` otherwise. */
  server(): Pick<FusionCommands, "listNodes"> | undefined;
  /** The Current Project's CLI runner; throws when no executable is committed. */
  cli(): Pick<FusionCli, "run">;
  log: Log;
}

/**
 * Resolves exclusion rules, which are dbt selectors, to the unique IDs they select. `dbt.listNodes` answers while the
 * language server runs. Otherwise `dbt ls` answers, and so does the CLI when the server's request fails.
 *
 * An answer is kept per manifest and rule, so a new manifest asks again. A failure is not kept, so the next request
 * asks again too. The rule text stays here: callers receive IDs.
 */
export class LineageExclusions {
  private readonly answers = new WeakMap<
    Manifest,
    Map<string, Promise<readonly string[]>>
  >();
  private readonly sources: ExclusionSources;

  constructor(sources: ExclusionSources) {
    this.sources = sources;
  }

  /** Each rule's resolution against `manifest`, in the order of `rules`. One rule's failure leaves the others standing. */
  async resolveRules(
    manifest: Manifest,
    rules: readonly string[],
  ): Promise<RuleResolution[]> {
    return Promise.all(
      rules.map(async (rule): Promise<RuleResolution> => {
        try {
          return { rule, ids: await this.idsOf(manifest, rule) };
        } catch (error) {
          return { rule, failure: errorMessage(error) };
        }
      }),
    );
  }

  private idsOf(manifest: Manifest, rule: string): Promise<readonly string[]> {
    const answers = this.answersFor(manifest);
    let ids = answers.get(rule);
    if (!ids) {
      ids = this.resolve(rule);
      answers.set(rule, ids);
      void ids.catch(() => {
        answers.delete(rule);
      });
    }
    return ids;
  }

  private answersFor(manifest: Manifest) {
    let answers = this.answers.get(manifest);
    if (!answers) {
      answers = new Map();
      this.answers.set(manifest, answers);
    }
    return answers;
  }

  private async resolve(rule: string): Promise<readonly string[]> {
    const server = this.sources.server();
    if (server) {
      try {
        const result = await server.listNodes([rule], { purpose: "graph" });
        return uniqueIdsOf(result.nodes ?? []);
      } catch (error) {
        this.sources.log.warn(
          LOG_SOURCE,
          `dbt.listNodes did not resolve an exclusion rule; asking dbt ls: ${errorMessage(error)}`,
        );
      }
    }
    const { stdout, stderr, exitCode } = await this.sources
      .cli()
      .run({ kind: "ls", select: rule });
    if (exitCode !== 0) {
      throw new Error(
        firstLogLine(stderr) || `dbt ls exited with code ${exitCode}`,
      );
    }
    return lsUniqueIds(stdout);
  }
}

/** The `unique_id` of each node that has one, in order. */
function uniqueIdsOf(nodes: readonly unknown[]): string[] {
  return nodes.flatMap((node) => {
    const id = (node as { unique_id?: unknown } | null)?.unique_id;
    return typeof id === "string" ? [id] : [];
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
