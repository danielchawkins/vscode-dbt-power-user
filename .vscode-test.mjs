import { defineConfig } from "@vscode/test-cli";
import {
  labelLayout,
  LABELS,
  nativeMode,
  ROOT_ENV,
  VSCODE_VERSION,
} from "./scripts/test/integration-layout.mjs";

// scripts/test/run-integration.mjs creates the ephemeral root, prepares each label under it, and removes it.
const root = process.env[ROOT_ENV];
if (!root) {
  throw new Error(
    `${ROOT_ENV} is unset; run integration tests through \`just test-integration\``,
  );
}

const suites = "out/test/integration";

/** Suites and extra environment per label; every other suite assumes a different workspace. */
const selection = {
  trusted: {
    files: `${suites}/!(columnLineage|lineageTableEdges|targetChange).test.js`,
  },
  symlinked: {
    files: `${suites}/symlinkedWorkspace.test.js`,
    env: { FPU_SYMLINKED_WORKSPACE: "1" },
  },
};

export default defineConfig(
  LABELS.map((label) => {
    const layout = labelLayout(root, label);
    const mode = nativeMode(label);
    const { files, env } = mode
      ? {
          files: [
            `${suites}/nativeEditorFeatures.test.js`,
            `${suites}/columnLineage.test.js`,
            `${suites}/lineageTableEdges.test.js`,
            `${suites}/targetChange.test.js`,
          ],
          env: {
            FPU_NATIVE_EDITOR_MODE: mode,
            FPU_INTEGRATION_COMMANDS: "1",
          },
        }
      : selection[label];
    return {
      label,
      version: VSCODE_VERSION,
      files,
      mocha: { ui: "tdd", timeout: 30_000, color: true },
      launchArgs: [
        layout.workspace,
        `--user-data-dir=${layout.userData}`,
        `--extensions-dir=${layout.extensions}`,
        "--use-inmemory-secretstorage",
      ],
      // Both variables dbt reads point at an empty directory, so only the setting can resolve the fixture profile.
      env: {
        DBT_PROFILES_DIR: layout.decoyProfiles,
        DBT_ENGINE_PROFILES_DIR: layout.decoyProfiles,
        ...env,
      },
    };
  }),
);
