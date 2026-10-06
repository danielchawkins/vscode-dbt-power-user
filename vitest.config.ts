import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) =>
  fileURLToPath(new URL(path, import.meta.url));

const ceilings = JSON.parse(
  readFileSync(fromRoot("./scripts/quality/ceilings.json"), "utf8"),
) as Record<string, Record<string, number>>;

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^(\.{1,2}\/)+extensionRoot$/,
        replacement: fromRoot("./src/test/mock/extensionRoot.ts"),
      },
      { find: /^vscode$/, replacement: fromRoot("./src/test/mock/vscode.ts") },
      {
        find: /^vscode-languageclient\/node$/,
        replacement: fromRoot("./src/test/mock/vscode-languageclient-node.ts"),
      },
      {
        find: /^@fusion-power-user\/webview-contract$/,
        replacement: fromRoot("./packages/webview-contract/src/index.ts"),
      },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    taskTitleValueFormatTruncate: 0,
    include: ["src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "src/test/integration/**",
      "src/test/smoke/**",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
      exclude: ["src/test/**", "packages/*/src/**/*.test.ts"],
      reportsDirectory: "coverage",
      reporter: ["text-summary"],
      thresholds: ceilings["coverage.host"],
    },
  },
});
