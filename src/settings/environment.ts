/** Extension-host environment variables that override product behaviour, keyed by reader name. */
const ENVIRONMENT_OVERRIDES = {
  /** Overrides `fusionPowerUser.lsp.compiledOutput` for every project. */
  lspCompiledOutput: "FUSION_POWER_USER_LSP_COMPILED_OUTPUT",
  /** Replaces `<project>/dbt_loom.config.yml` as the dbt-loom config path. */
  dbtLoomConfigPath: "DBT_LOOM_CONFIG_PATH",
} as const;

/** Set by this repository's smoke and benchmark runners, never by users. */
export const HARNESS_SWITCHES = {
  /** `"1"` records webview runtime timings for the benchmark. */
  runtimeBenchmark: "FPU_RUNTIME_BENCHMARK",
  /** The smoke-test host (`"vscode"` or `"cursor"`); enables test-only commands. */
  smokeHost: "FPU_SMOKE_HOST",
  /** `"1"` enables the test-only commands the integration suites call. */
  integrationCommands: "FPU_INTEGRATION_COMMANDS",
} as const;

export type EnvironmentOverride = keyof typeof ENVIRONMENT_OVERRIDES;
export type HarnessSwitch = keyof typeof HARNESS_SWITCHES;

/** Reads one override from the extension host's environment at call time. */
export function readEnvironmentOverride(
  override: EnvironmentOverride,
): string | undefined {
  return process.env[ENVIRONMENT_OVERRIDES[override]];
}

/** Reads one harness switch from the extension host's environment at call time. */
export function readHarnessSwitch(name: HarnessSwitch): string | undefined {
  return process.env[HARNESS_SWITCHES[name]];
}

/** True when the smoke harness (on VS Code or Cursor) or the integration suites run, which call test-only commands. */
export function testCommandsEnabled(): boolean {
  const host = readHarnessSwitch("smokeHost");
  return (
    host === "vscode" ||
    host === "cursor" ||
    readHarnessSwitch("integrationCommands") === "1"
  );
}

/** Reads a user-named variable, as referenced by `${env:NAME}` in a setting. */
export function readEnvironmentVariable(name: string): string | undefined {
  return process.env[name];
}

/** A copy of the extension host's environment without unset entries. */
export function readEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}
