import { existsSync, readFileSync, realpathSync } from "fs";
import * as path from "path";
import { parse } from "yaml";

/** Absolute resource directories of one dbt project, from `dbt_project.yml` with dbt's defaults filling gaps. */
export interface ProjectPaths {
  modelPaths: string[];
  seedPaths: string[];
  macroPaths: string[];
  snapshotPaths: string[];
  analysisPaths: string[];
  testPaths: string[];
  targetPath: string;
  packagesInstallPath: string;
}

const LIST_KEYS = {
  modelPaths: ["model-paths", "models"],
  seedPaths: ["seed-paths", "seeds"],
  macroPaths: ["macro-paths", "macros"],
  snapshotPaths: ["snapshot-paths", "snapshots"],
  analysisPaths: ["analysis-paths", "analyses"],
  testPaths: ["test-paths", "tests"],
} as const;

const SCALAR_KEYS = {
  targetPath: ["target-path", "target"],
  packagesInstallPath: ["packages-install-path", "dbt_packages"],
} as const;

/** `model-paths` or its legacy snake_case spelling. */
function configured(config: Record<string, unknown>, key: string): unknown {
  return config[key] ?? config[key.replace(/-/g, "_")];
}

/**
 * Reads the resource paths a project declares. A key that is absent or not the expected shape falls back to dbt's
 * default directory, so the standard layout works without any declaration and a malformed file never throws.
 */
export function resolveProjectPaths(projectRoot: string): ProjectPaths {
  let config: Record<string, unknown> = {};
  const file = path.join(projectRoot, "dbt_project.yml");
  if (existsSync(file)) {
    try {
      const parsed: unknown = parse(readFileSync(file, "utf8"), {
        strict: false,
        uniqueKeys: false,
        maxAliasCount: -1,
      });
      if (parsed && typeof parsed === "object") {
        config = parsed as Record<string, unknown>;
      }
    } catch {
      // Defaults apply; the language server reports the parse error.
    }
  }
  const absolute = (p: string) => path.resolve(projectRoot, p);
  const result = {} as ProjectPaths;
  for (const [field, [key, fallback]] of Object.entries(LIST_KEYS)) {
    const value = configured(config, key);
    const list = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    result[field as keyof typeof LIST_KEYS] = (
      list.length ? list : [fallback]
    ).map(absolute);
  }
  for (const [field, [key, fallback]] of Object.entries(SCALAR_KEYS)) {
    const value = configured(config, key);
    result[field as keyof typeof SCALAR_KEYS] = absolute(
      typeof value === "string" && value.length > 0 ? value : fallback,
    );
  }
  return result;
}

/** True when `file` is `dir` or inside it, comparing real paths so symlinked and `/private` aliases agree. */
export function isWithin(dir: string, file: string): boolean {
  const relative = path.relative(canonical(dir), canonical(file));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/** Real path of `p`, or of its nearest existing ancestor joined with the rest, so unsaved paths still compare. */
function canonical(p: string): string {
  const missing: string[] = [];
  let current = path.resolve(p);
  for (;;) {
    try {
      return path.join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return path.resolve(p);
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * True for a Jinja-templated dbt source file: a `.sql` file under a model, macro, snapshot, analysis or test
 * path, or under the packages install path. Anything under the target path is compiled output and is excluded.
 */
export function isDbtTemplateFile(
  paths: ProjectPaths,
  fsPath: string,
): boolean {
  if (
    !fsPath.toLowerCase().endsWith(".sql") ||
    isWithin(paths.targetPath, fsPath)
  ) {
    return false;
  }
  return [
    ...paths.modelPaths,
    ...paths.macroPaths,
    ...paths.snapshotPaths,
    ...paths.analysisPaths,
    ...paths.testPaths,
    paths.packagesInstallPath,
  ].some((dir) => isWithin(dir, fsPath));
}
