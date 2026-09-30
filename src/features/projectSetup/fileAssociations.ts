import { commands, Disposable, window } from "vscode";
import { readDbtProjectFile, resolveProjectPaths } from "../../core/project";
import {
  dbtTemplateAssociations,
  literalGlobPath,
  SkippedDirectory,
  SkipReason,
} from "../../dbt_integration/dbtAssociations";
import { ProjectRegistry } from "../../projects/projectRegistry";
import {
  FileAssociations,
  readUserFileAssociations,
  writeUserFileAssociations,
} from "../../settings";
import { StartupGate } from "../../startupGate";

/** How many user associations one run added and removed. */
export interface AssociationChanges {
  readonly added: number;
  readonly removed: number;
}

const TEMPLATE_LANGUAGE = "jinja-sql";
const TEMPLATE_SUFFIX = "/**/*.sql";

const SKIP_REASONS: Record<SkipReason, string> = {
  brace: 'VS Code globs cannot match a literal "{"',
  projectRoot:
    "a glob on the project root would also match its target directory",
};

/** Glob key comparison form: lower case where VS Code matches globs case-insensitively. */
function comparisonKey(pattern: string): string {
  return process.platform === "darwin" || process.platform === "win32"
    ? pattern.toLowerCase()
    : pattern;
}

interface DesiredAssociations {
  /** Wanted glob patterns by comparison key. */
  readonly wanted: Map<string, string>;
  /** Comparison-key prefixes of every project root glob. */
  readonly rootPrefixes: readonly string[];
  readonly skipped: readonly SkippedDirectory[];
}

function desiredAssociations(roots: readonly string[]): DesiredAssociations {
  const wanted = new Map<string, string>();
  const rootPrefixes: string[] = [];
  const skipped: SkippedDirectory[] = [];
  for (const root of roots) {
    const result = dbtTemplateAssociations(
      root,
      resolveProjectPaths(root, readDbtProjectFile(root).config),
    );
    rootPrefixes.push(comparisonKey(`${literalGlobPath(root)}/`));
    skipped.push(...result.skipped);
    for (const pattern of Object.keys(result.associations)) {
      const key = comparisonKey(pattern);
      if (!wanted.has(key)) {
        wanted.set(key, pattern);
      }
    }
  }
  return { wanted, rootPrefixes, skipped };
}

function isStale(
  pattern: string,
  language: string,
  desired: DesiredAssociations,
): boolean {
  const key = comparisonKey(pattern);
  return (
    language === TEMPLATE_LANGUAGE &&
    pattern.endsWith(TEMPLATE_SUFFIX) &&
    !desired.wanted.has(key) &&
    desired.rootPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

/** `current` without stale template globs and with every missing wanted glob. */
function reconcile(
  current: FileAssociations,
  desired: DesiredAssociations,
): AssociationChanges & { readonly next: FileAssociations } {
  const next: Record<string, string> = {};
  const present = new Set<string>();
  let removed = 0;
  for (const [pattern, language] of Object.entries(current)) {
    if (isStale(pattern, language, desired)) {
      removed++;
    } else {
      next[pattern] = language;
      present.add(comparisonKey(pattern));
    }
  }
  let added = 0;
  for (const [key, pattern] of desired.wanted) {
    if (!present.has(key)) {
      next[pattern] = TEMPLATE_LANGUAGE;
      added++;
    }
  }
  return { next, added, removed };
}

/** The "Configure dbt file associations" command. */
export class FileAssociationsCommand implements Disposable {
  private readonly disposables: Disposable[];

  constructor(
    private readonly startupGate: Pick<StartupGate, "whenSettled">,
    private readonly registry: Pick<ProjectRegistry, "projects">,
  ) {
    this.disposables = [
      commands.registerCommand(
        "fusionPowerUser.configureFileAssociations",
        () => this.run(),
      ),
    ];
  }

  private async run(): Promise<AssociationChanges | undefined> {
    await this.startupGate.whenSettled();
    try {
      return await this.writeUserAssociations();
    } catch (error) {
      void window.showErrorMessage(
        `Could not write dbt file associations: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Makes user `files.associations` hold one `jinja-sql` glob per Declared Project template path, in one write.
   * Adds missing globs, removes `jinja-sql` template globs inside a project root that the project no longer
   * declares, and keeps every other entry. Keys compare case-insensitively on macOS and Windows.
   */
  async writeUserAssociations(): Promise<AssociationChanges> {
    const projects = this.registry.projects;
    if (projects.length === 0) {
      void window.showInformationMessage("No dbt projects found.");
      return { added: 0, removed: 0 };
    }
    const desired = desiredAssociations(projects.map((p) => p.root.fsPath));
    const { next, added, removed } = reconcile(
      readUserFileAssociations(),
      desired,
    );
    if (added > 0 || removed > 0) {
      await writeUserFileAssociations(next);
    }
    void window.showInformationMessage(
      added === 0 && removed === 0
        ? "dbt file associations are already up to date."
        : `Updated dbt file associations in user settings: ${added} added, ${removed} removed.`,
    );
    if (desired.skipped.length > 0) {
      void window.showWarningMessage(
        `Skipped dbt file associations for: ${desired.skipped
          .map(({ dir, reason }) => `${dir} (${SKIP_REASONS[reason]})`)
          .join("; ")}.`,
      );
    }
    return { added, removed };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
