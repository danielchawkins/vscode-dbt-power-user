import { ConfigurationTarget, Disposable, Uri, workspace } from "vscode";
import { DeferSettingsEntry } from "../core/project";

export * from "./environment";

/** @internal */
export const CONFIGURATION_SECTION = "fusionPowerUser";

/**
 * Every contributed `fusionPowerUser.*` setting, keyed relative to the section. Enum-valued settings are `string`
 * because users can write any value; their readers narrow it.
 *
 * Values come from user input; callers validate.
 */
export interface SettingsSchema {
  "lineage.defaultExpansion": number;
  enabled: boolean;
  projects: readonly string[];
  staticAnalysis: string;
  dbtPath: string | undefined;
  profilesDir: string | undefined;
  target: string | undefined;
  "lsp.compiledOutput": string;
  "lint.enabled": boolean;
  "trace.server": string;
  unquotedCaseInsensitiveIdentifierRegex: string | undefined;
  "run.additionalParams": readonly string[];
  "build.additionalParams": readonly string[];
  "test.additionalParams": readonly string[];
  "query.limit": number;
  "generateModel.fileNameTemplate": string;
  "generateModel.prefix": string;
  "defer.perProject": Readonly<Record<string, DeferSettingsEntry>> | undefined;
}

export type SettingKey = keyof SettingsSchema;

/**
 * The package.json `scope` of each setting; `window` where package.json omits it.
 * @internal
 */
export const SETTING_SCOPES = {
  "lineage.defaultExpansion": "window",
  enabled: "resource",
  projects: "resource",
  staticAnalysis: "resource",
  dbtPath: "resource",
  profilesDir: "resource",
  target: "resource",
  "lsp.compiledOutput": "resource",
  "lint.enabled": "resource",
  "trace.server": "resource",
  unquotedCaseInsensitiveIdentifierRegex: "window",
  "run.additionalParams": "window",
  "build.additionalParams": "window",
  "test.additionalParams": "window",
  "query.limit": "window",
  "generateModel.fileNameTemplate": "window",
  "generateModel.prefix": "window",
  "defer.perProject": "resource",
} as const satisfies Record<SettingKey, "resource" | "window">;

type SettingKeyWithScope<S> = {
  [K in SettingKey]: (typeof SETTING_SCOPES)[K] extends S ? K : never;
}[SettingKey];
export type ResourceSettingKey = SettingKeyWithScope<"resource">;
export type WindowSettingKey = SettingKeyWithScope<"window">;

/**
 * Reads one setting; VS Code falls back to its contributed default. Resource-scoped keys read for `resource`;
 * window-scoped keys take none.
 */
export function readSetting<K extends ResourceSettingKey>(
  key: K,
  resource: Uri,
): SettingsSchema[K];
export function readSetting<K extends WindowSettingKey>(
  key: K,
): SettingsSchema[K];
export function readSetting<K extends SettingKey>(
  key: K,
  resource?: Uri,
): SettingsSchema[K] {
  return workspace
    .getConfiguration(CONFIGURATION_SECTION, resource)
    .get<SettingsSchema[K]>(key) as SettingsSchema[K];
}

/** Writes one window-scoped setting; `undefined` removes it. */
export function writeSetting<K extends WindowSettingKey>(
  key: K,
  value: SettingsSchema[K] | undefined,
): Thenable<void> {
  return workspace.getConfiguration(CONFIGURATION_SECTION).update(key, value);
}

/** One top-level `fusionPowerUser` entry: its effective value and the layer overriding the default, if any. */
export interface SettingInspection {
  key: string;
  value: unknown;
  overriddenIn?: "workspace" | "user";
}

/**
 * Inspects every key present in the user, default or workspace value of the section, in that order. Keys set in
 * several layers repeat. A value differing from the default is attributed to the workspace layer when it matches
 * it, else to the user layer when it matches that.
 */
export function inspectSettings(): SettingInspection[] {
  const inspected = workspace
    .getConfiguration()
    .inspect<Record<string, unknown>>(CONFIGURATION_SECTION);
  const globalValue = inspected?.globalValue || {};
  const defaultValue = inspected?.defaultValue || {};
  const workspaceValue = inspected?.workspaceValue || {};
  const section = workspace.getConfiguration(CONFIGURATION_SECTION);
  return [
    ...Object.keys(globalValue),
    ...Object.keys(defaultValue),
    ...Object.keys(workspaceValue),
  ].map((key) => {
    const value = section.get(key);
    if (deepEqual(value, defaultValue[key])) {
      return { key, value };
    }
    if (deepEqual(value, workspaceValue[key])) {
      return { key, value, overriddenIn: "workspace" };
    }
    if (deepEqual(value, globalValue[key])) {
      return { key, value, overriddenIn: "user" };
    }
    return { key, value };
  });
}

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => key in right && deepEqual(left[key], right[key]))
  );
};

/** VS Code's `files.associations` glob-to-language map. */
export type FileAssociations = Readonly<Record<string, string>>;

/** `files.associations` set in user settings, excluding workspace and folder values. */
export function readUserFileAssociations(): FileAssociations {
  return (
    workspace
      .getConfiguration("files")
      .inspect<FileAssociations>("associations")?.globalValue ?? {}
  );
}

/** Replaces `files.associations` in user settings. */
export function writeUserFileAssociations(
  associations: FileAssociations,
): Thenable<void> {
  return workspace
    .getConfiguration("files")
    .update("associations", associations, ConfigurationTarget.Global);
}

/** Sets `fusionPowerUser.staticAnalysis` to `strict` in the workspace-folder settings containing `root`. */
export function writeStrictStaticAnalysis(root: Uri): Thenable<void> {
  return workspace
    .getConfiguration(CONFIGURATION_SECTION, root)
    .update("staticAnalysis", "strict", ConfigurationTarget.WorkspaceFolder);
}

/** A configuration change, queried for the keys it was subscribed with. */
export interface SettingsChange {
  /** Whether a subscribed key changed for `resource`, or in any scope when omitted. */
  affects(resource?: Uri): boolean;
}

/** Calls `listener` on every configuration change; it checks `affects` for the resources it owns. */
export function onDidChangeSettings(
  keys: readonly SettingKey[],
  listener: (change: SettingsChange) => void,
): Disposable {
  return workspace.onDidChangeConfiguration((event) =>
    listener({
      affects: (resource) =>
        keys.some((key) =>
          event.affectsConfiguration(
            `${CONFIGURATION_SECTION}.${key}`,
            resource,
          ),
        ),
    }),
  );
}
