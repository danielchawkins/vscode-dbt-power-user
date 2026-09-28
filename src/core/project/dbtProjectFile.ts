import { readFileSync } from "fs";
import * as path from "path";
import { parse } from "yaml";

export const DBT_PROJECT_FILE = "dbt_project.yml";

/** The top-level mapping of a parsed `dbt_project.yml`; values are unvalidated. */
export type DbtProjectConfig = Readonly<Record<string, unknown>>;

/** One read of a project file. `config` is empty unless the file parsed to a mapping. */
export type DbtProjectFile =
  | { kind: "parsed"; text: string; config: DbtProjectConfig }
  | { kind: "invalid"; text: string; message: string; config: DbtProjectConfig }
  | { kind: "unreadable"; message: string; config: DbtProjectConfig }
  | { kind: "missing"; config: DbtProjectConfig };

export function dbtProjectFilePath(root: string): string {
  return path.join(root, DBT_PROJECT_FILE);
}

/** Parses project-file text; never throws. */
export function parseDbtProjectYaml(text: string): DbtProjectFile {
  try {
    const parsed: unknown = parse(text, {
      strict: false,
      uniqueKeys: false,
      maxAliasCount: -1,
    });
    const config =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as DbtProjectConfig)
        : {};
    return { kind: "parsed", text, config };
  } catch (error) {
    return {
      kind: "invalid",
      text,
      message: errorMessage(error),
      config: {},
    };
  }
}

/** Reads and parses `<root>/dbt_project.yml`; never throws. */
export function readDbtProjectFile(root: string): DbtProjectFile {
  let text: string;
  try {
    text = readFileSync(dbtProjectFilePath(root), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { kind: "missing", config: {} };
    }
    return { kind: "unreadable", message: errorMessage(error), config: {} };
  }
  return parseDbtProjectYaml(text);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The project's declared `name`, when it is a non-empty string. */
export function declaredProjectName(
  config: DbtProjectConfig,
): string | undefined {
  const name = config.name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}
