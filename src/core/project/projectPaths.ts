import * as path from "path";
import { DbtProjectConfig } from "./dbtProjectFile";

/** Absolute resource directories of one dbt project, from its project file with dbt's defaults filling gaps. */
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
function configured(config: DbtProjectConfig, key: string): unknown {
  return config[key] ?? config[key.replace(/-/g, "_")];
}

/**
 * The resource paths `config` declares, resolved against `projectRoot`. A key that is absent or not the expected
 * shape falls back to dbt's default directory, so the standard layout works without any declaration.
 */
export function resolveProjectPaths(
  projectRoot: string,
  config: DbtProjectConfig,
): ProjectPaths {
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
