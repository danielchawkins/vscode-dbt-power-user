import type { lineage } from "@fusion-power-user/webview-contract";
import type { Disposable } from "vscode";
import { firstLogLine, lsUniqueIds } from "../../core/cli";
import type { Log } from "../../core/log";
import type { FusionCli } from "../../fusion/fusionCli";
import type { FusionCommands } from "../../fusion/fusionCommands";
import type { Manifest } from "../../projects/manifest/manifestTypes";
import { onDidChangeSettings, readSetting, writeSetting } from "../../settings";

const LOG_SOURCE = "Lineage:exclusion";

/** What one exclusion rule selects in a manifest: its unique IDs, or why dbt could not say. */
export type RuleResolution =
  | { rule: string; ids: readonly string[] }
  | { rule: string; failure: string };

/** The answer for a rule when no manifest is loaded: dbt cannot resolve a rule before one is. */
const NO_MANIFEST = "Lineage needs a compiled project.";

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

/** Whether `rule` names `resource_type:macro`, which Fusion 2.0.6 returns no macros for; see docs/lsp-metadata-gaps.md. */
function namesMacro(rule: string): boolean {
  return /(?:^|[\s,])resource_type:macro(?=$|[\s,])/.test(rule);
}

/** The answer for one rule the user wrote: its count of excluded nodes, or the failure dbt gave. */
function answerOf(
  rule: string,
  resolution: RuleResolution,
): lineage.ExclusionRule {
  const named = { rule, namesMacro: namesMacro(rule) };
  return "ids" in resolution
    ? { ...named, count: new Set(resolution.ids).size }
    : { ...named, failure: resolution.failure };
}

/** The `lineage.exclude` entries as the user wrote them, without blank ones. */
function writtenRules(): string[] {
  return (readSetting("lineage.exclude") ?? []).filter(
    (rule) => rule.trim() !== "",
  );
}

/**
 * Each rule the setting holds, as written, with the nodes it excludes in `manifest` or the failure dbt gave. A rule
 * resolves against the trimmed text; the IDs stay here, and only the count leaves.
 */
export async function exclusionAnswers(
  exclusions: LineageExclusions,
  manifest: Manifest | undefined,
): Promise<lineage.ExclusionRule[]> {
  const written = writtenRules();
  const resolutions: RuleResolution[] = manifest
    ? await exclusions.resolveRules(
        manifest,
        written.map((rule) => rule.trim()),
      )
    : written.map((rule) => ({ rule, failure: NO_MANIFEST }));
  return written.map((rule, index) => answerOf(rule, resolutions[index]!));
}

/** Appends `rule`, trimmed, to the setting, unless the setting already holds it. */
export async function addExclusionRule(rule: string): Promise<void> {
  const text = rule.trim();
  const written = readSetting("lineage.exclude") ?? [];
  if (text !== "" && !written.some((entry) => entry.trim() === text)) {
    await writeSetting("lineage.exclude", [...written, text]);
  }
}

/** Removes the setting's first entry that is exactly `rule`; the other entries stay as they are. */
export async function removeExclusionRule(rule: string): Promise<void> {
  const written = readSetting("lineage.exclude") ?? [];
  const index = written.indexOf(rule);
  if (index >= 0) {
    await writeSetting(
      "lineage.exclude",
      written.filter((_, position) => position !== index),
    );
  }
}

/** Calls `listener` when the `lineage.exclude` setting changes, in any scope. */
export function onExclusionsChanged(listener: () => void): Disposable {
  // ast-grep-ignore: ts-settings-subscribers-listed -- lineage.exclude is window-scoped, so no Project Snapshot carries it, and a change must refetch the graph.
  return onDidChangeSettings(["lineage.exclude"], (change) => {
    if (change.affects()) {
      listener();
    }
  });
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
