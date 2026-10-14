import oxlint from "eslint-plugin-oxlint";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import { restrictedSyntax } from "./lint/boundaries.mjs";

// Scoped and untyped: ESLint runs only the rules Oxlint can't host natively.
// Violations present when a rule was introduced live in eslint-suppressions.json; new ones fail `just lint`.
// Fixing one requires `just lint-prune` so the baseline only ever shrinks.

const SOURCE_FILES = ["src/**/*.ts", "packages/*/src/**/*.ts"];
const TEST_FILES = ["src/test/**/*.ts", "packages/*/src/**/*.test.ts"];

// Flat config replaces rule options per file, so an exemption re-sets the whole rule minus its own entries.
// The lists and builders come from lint/boundaries.mjs, which the Oxlint config shares.
const ESLINT_RULES = {
  "no-restricted-syntax": restrictedSyntax(),
  "sonarjs/cognitive-complexity": ["error", 15],
  "sonarjs/no-identical-functions": "error",
  "sonarjs/no-duplicated-branches": "error",
  "sonarjs/no-collapsible-if": "error",
  "sonarjs/no-inverted-boolean-check": "error",
  "sonarjs/prefer-single-boolean-return": "error",
};

export default defineConfig(
  {
    ignores: [
      "out/**",
      "dist/**",
      "packages/*/dist/**",
      "webview_panels/**",
      "src/test/fixtures/**",
      "**/*.d.ts",
      "scripts/spikes/**",
    ],
  },
  {
    files: SOURCE_FILES,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    plugins: { sonarjs },
    rules: ESLINT_RULES,
  },
  {
    files: ["src/settings/**/*.ts"],
    rules: {
      "no-restricted-syntax": restrictedSyntax({
        except: ["settings", "postMessage"],
      }),
    },
  },
  {
    files: ["src/fusion/process.ts"],
    rules: {
      "no-restricted-syntax": restrictedSyntax({
        except: ["process", "postMessage"],
      }),
    },
  },
  {
    // Tests trade size budgets for readable, table-driven cases.
    files: TEST_FILES,
    rules: {
      "no-restricted-syntax": "off",
      "sonarjs/no-identical-functions": "off",
    },
  },
  // Turns off every rule Oxlint runs, so nothing is reported twice. It must stay last.
  ...oxlint.configs["flat/all"],
);
