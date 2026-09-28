import { Disposable, Uri, workspace } from "vscode";

export const CONFIGURATION_SECTION = "fusionPowerUser";

/** One project's entry in `fusionPowerUser.defer.perProject`, keyed by project-relative path. */
export interface DeferSettingsEntry {
  deferToProduction: boolean;
  favorState: boolean;
  manifestPathForDeferral?: string;
}

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
  "queryResults.theme": string;
  "query.template": string;
  "generateModel.fileNameTemplate": string;
  "generateModel.prefix": string;
  "defer.perProject": Readonly<Record<string, DeferSettingsEntry>> | undefined;
}

export type SettingKey = keyof SettingsSchema;

/** The package.json `scope` of each setting; `window` where package.json omits it. */
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
  "queryResults.theme": "window",
  "query.template": "window",
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
