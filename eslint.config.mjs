import prettier from "eslint-config-prettier/flat";
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";
import {
  restrictedImports,
  restrictedProperties,
  restrictedSyntax,
} from "./lint/boundaries.mjs";

// Violations present when a rule was introduced live in eslint-suppressions.json; new ones fail `just lint`.
// Fixing one requires `npm run lint:prune` so the baseline only ever shrinks.

// Flat config replaces rule options per file, so an exemption re-sets the whole rule minus its own entries.
// The lists and builders come from lint/boundaries.mjs, which the Oxlint config shares.

const BUG_CLASS_RULES = {
  "@typescript-eslint/no-for-in-array": "error",
  "@typescript-eslint/no-misused-spread": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
  "@typescript-eslint/switch-exhaustiveness-check": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  "@typescript-eslint/only-throw-error": "error",
  "@typescript-eslint/ban-ts-comment": [
    "error",
    { "ts-expect-error": "allow-with-description" },
  ],
  "no-async-promise-executor": "error",
};

export default [
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
  tseslint.configs.base,
  tseslint.configs.eslintRecommended,
  prettier,
  {
    files: ["src/**/*.ts", "packages/*/src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: {
          allowDefaultProject: ["packages/*/src/*.test.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { sonarjs },
    rules: {
      curly: "error",
      eqeqeq: "error",
      "no-throw-literal": "error",
      // Size and branching budgets.
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
      "max-lines": [
        "error",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
      "sonarjs/cognitive-complexity": ["error", 15],
      "sonarjs/no-identical-functions": "error",
      "sonarjs/no-duplicated-branches": "error",
      "sonarjs/no-collapsible-if": "error",
      "sonarjs/no-inverted-boolean-check": "error",
      "sonarjs/prefer-single-boolean-return": "error",
      // Type-aware correctness.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      ...BUG_CLASS_RULES,
      // Confinement: settings and environment reads, process spawning and user-file writes each have one home.
      "no-restricted-properties": restrictedProperties(),
      "no-restricted-syntax": restrictedSyntax(),
      "@typescript-eslint/no-require-imports": "error",
      "no-restricted-imports": restrictedImports(),
    },
  },
  {
    files: ["src/projects/notifications.ts", "src/projects/projectErrors.ts"],
    rules: {
      "no-restricted-properties": restrictedProperties({
        except: ["errorMessage"],
      }),
    },
  },
  {
    files: ["src/settings/**/*.ts"],
    rules: {
      "no-restricted-properties": restrictedProperties({
        except: ["settings", "environment", "errorMessage"],
      }),
      "no-restricted-syntax": restrictedSyntax({
        except: ["settings", "postMessage"],
      }),
      "no-restricted-imports": restrictedImports({ except: ["environment"] }),
    },
  },
  {
    files: ["src/fusion/process.ts"],
    rules: {
      "no-restricted-syntax": restrictedSyntax({
        except: ["process", "postMessage"],
      }),
      "no-restricted-imports": restrictedImports({ except: ["process"] }),
    },
  },
  {
    // The manifest core reads untyped JSON; every value is typed at its entry.
    files: ["src/core/**/*.ts", "src/settings/**/*.ts", "src/fusion/**/*.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
    },
  },
  {
    // Production code logs through DBTTerminal; scripts, configs and tests may print.
    files: ["src/**/*.ts"],
    ignores: ["src/test/**"],
    rules: { "no-console": "error" },
  },
  {
    // Tests trade size budgets for readable, table-driven cases.
    files: ["src/test/**/*.ts", "packages/*/src/**/*.test.ts"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "sonarjs/no-identical-functions": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-properties": "off",
      "no-restricted-syntax": "off",
      "no-restricted-imports": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
