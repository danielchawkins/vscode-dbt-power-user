import path from "path";

/** Integration labels, in run order. `native-*` open the native-editor fixture with one static-analysis mode. */
export const LABELS = [
  "trusted",
  "symlinked",
  "native-strict",
  "native-baseline",
  "native-project",
];

/** The VS Code release every label runs against. */
export const VSCODE_VERSION = "1.128.0";

/** The label launched directly, without test-cli, because test-electron always disables workspace trust. */
export const UNTRUSTED_LABEL = "untrusted";

/** The positive control for the untrusted label: the same VSIX launch with workspace trust disabled. */
export const TRUSTED_VSIX_LABEL = "trusted-vsix";

/** Labels launched directly against the packaged VSIX, in run order. */
export const VSIX_LABELS = [UNTRUSTED_LABEL, TRUSTED_VSIX_LABEL];

/**
 * The labels each Docker container runs, one after another. `trusted` is the longest label, so it has a shard
 * to itself; the others are grouped to even out the shards' wall time.
 */
export const DOCKER_SHARDS = [
  ["trusted"],
  ["native-strict", "symlinked"],
  ["native-baseline", UNTRUSTED_LABEL],
  ["native-project", TRUSTED_VSIX_LABEL],
];

/** The file under `<root>/spy` that the `dbt` wrapper appends each invocation to; see `run-integration.mjs`. */
export const SPY_LOG_FILE = "dbt-invocations.log";

/** The environment variable naming the ephemeral root that holds every label's directories. */
export const ROOT_ENV = "FPU_INTEGRATION_ROOT";

/** Where a label's user-data dir, extensions dir and opened workspace live under the ephemeral root. */
export function labelLayout(root, label) {
  // Short names: VS Code's IPC socket lives in the user-data dir, and macOS caps socket paths at 103 bytes.
  const base = path.join(
    root,
    String([...LABELS, ...VSIX_LABELS].indexOf(label)),
  );
  const workspaceName = {
    trusted: "single-project",
    [UNTRUSTED_LABEL]: "single-project",
    [TRUSTED_VSIX_LABEL]: "single-project",
    symlinked: "single-project-link",
  }[label];
  return {
    base,
    userData: path.join(base, "u"),
    extensions: path.join(base, "x"),
    workspace: path.join(
      base,
      workspaceName ?? `native-editor-${nativeMode(label)}`,
    ),
    decoyProfiles: path.join(base, "decoy-profiles"),
  };
}

/** The labels `run-integration.mjs` prepares: those `--label` selected, by name or `LABELS` index, or all when none was. */
export function labelsToPrepare(selected) {
  // test-cli also selects a config by its position in `LABELS`, so `--label 2` means the third label.
  const names = selected.map((s) => (/^\d+$/.test(s) ? LABELS[Number(s)] : s));
  return [...LABELS, ...VSIX_LABELS].filter(
    (label) => !selected.length || names.includes(label),
  );
}

/** The static-analysis mode a `native-*` label opens with, else undefined. */
export function nativeMode(label) {
  return label.startsWith("native-")
    ? label.slice("native-".length)
    : undefined;
}
