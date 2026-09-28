import * as path from "path";
import picomatch from "picomatch";
import { ProjectPaths } from "../core/project";

const matches = (value: string, pattern: string) =>
  picomatch.isMatch(value, pattern, { dot: true, nocase: true });

/**
 * `files.associations` entries that open a project's dbt templates as `jinja-sql`: one glob per model, macro,
 * snapshot, analysis and test path, relative to the workspace folder. Paths outside the folder are skipped because
 * VS Code resolves relative patterns against the folder.
 */
export function dbtTemplateAssociations(
  folderRoot: string,
  paths: ProjectPaths,
): Record<string, string> {
  const dirs = [
    ...paths.modelPaths,
    ...paths.macroPaths,
    ...paths.snapshotPaths,
    ...paths.analysisPaths,
    ...paths.testPaths,
  ];
  const result: Record<string, string> = {};
  for (const dir of dirs) {
    const relative = path.relative(folderRoot, dir).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      continue;
    }
    const prefix = relative === "" ? "" : `${relative}/`;
    result[`${prefix}**/*.sql`] = "jinja-sql";
  }
  return result;
}

/**
 * The language a user's `files.associations` gives `fsPath`, following VS Code's precedence: a pattern containing
 * `/` matches the path relative to the folder or absolute; otherwise it matches the file name. Longer patterns win.
 */
export function associatedLanguage(
  associations: Record<string, string>,
  folderRoot: string,
  fsPath: string,
): string | undefined {
  const relative = path.relative(folderRoot, fsPath).split(path.sep).join("/");
  const absolute = fsPath.split(path.sep).join("/");
  const name = path.basename(fsPath);
  let best: { pattern: string; language: string } | undefined;
  for (const [pattern, language] of Object.entries(associations)) {
    const onPath = pattern.includes("/");
    const matched = onPath
      ? matches(relative, pattern) || matches(absolute, pattern)
      : matches(name, pattern);
    if (matched && (!best || pattern.length > best.pattern.length)) {
      best = { pattern, language };
    }
  }
  return best?.language;
}
