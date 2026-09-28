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

/** The environment variable naming the ephemeral root that holds every label's directories. */
export const ROOT_ENV = "FPU_INTEGRATION_ROOT";

/** Where a label's user-data dir, extensions dir and opened workspace live under the ephemeral root. */
export function labelLayout(root, label) {
  // Short names: VS Code's IPC socket lives in the user-data dir, and macOS caps socket paths at 103 bytes.
  const base = path.join(
    root,
    String([...LABELS, UNTRUSTED_LABEL].indexOf(label)),
  );
  const workspaceName = {
    trusted: "single-project",
    [UNTRUSTED_LABEL]: "single-project",
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

/** The static-analysis mode a `native-*` label opens with, else undefined. */
export function nativeMode(label) {
  return label.startsWith("native-")
    ? label.slice("native-".length)
    : undefined;
}
