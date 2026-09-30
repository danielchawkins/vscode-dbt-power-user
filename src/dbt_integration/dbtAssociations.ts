import * as path from "path";
import { ProjectPaths } from "../core/project";

/** Why a template directory has no association. */
export type SkipReason = "brace" | "projectRoot";

/** A template directory left out of the associations. */
export interface SkippedDirectory {
  readonly dir: string;
  readonly reason: SkipReason;
}

/** The associations for one project, and the directories that could not be expressed. */
export interface DbtTemplateAssociations {
  readonly associations: Record<string, string>;
  readonly skipped: readonly SkippedDirectory[];
}

/**
 * `/` joined drive-letter or POSIX path in which VS Code's glob wildcards and class brackets are wrapped in a
 * one-character class, so it matches only itself. VS Code globs have no escape character; `( ) !` are literal.
 */
export function literalGlobPath(dir: string): string {
  return path
    .resolve(dir)
    .split(path.sep)
    .map((part) => part.replace(/[*?[\]}]/g, "[$&]"))
    .join("/");
}

/**
 * `files.associations` entries that open a project's dbt templates as `jinja-sql`: one absolute
 * `<dir>/**\/*.sql` glob per model, macro, snapshot, analysis and test path and the packages install path.
 * A directory containing `{` is skipped because VS Code globs cannot express a literal `{`; one equal to
 * `projectRoot` is skipped because its glob would also capture the target directory.
 */
export function dbtTemplateAssociations(
  projectRoot: string,
  paths: ProjectPaths,
): DbtTemplateAssociations {
  const dirs = [
    ...paths.modelPaths,
    ...paths.macroPaths,
    ...paths.snapshotPaths,
    ...paths.analysisPaths,
    ...paths.testPaths,
    paths.packagesInstallPath,
  ];
  const root = path.resolve(projectRoot);
  const associations: Record<string, string> = {};
  const skipped: SkippedDirectory[] = [];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (resolved === root) {
      skipped.push({ dir: resolved, reason: "projectRoot" });
    } else if (resolved.includes("{")) {
      skipped.push({ dir: resolved, reason: "brace" });
    } else {
      associations[`${literalGlobPath(resolved)}/**/*.sql`] = "jinja-sql";
    }
  }
  return { associations, skipped };
}
