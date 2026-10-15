// Oxlint config for the root workspace; `just lint-code` runs it over src, scripts and packages.
// Plain data: nothing is exported as a function, so the fixture harness can serialise it.
// Boundary lists come from lint/boundaries.mjs, the same module eslint.config.mjs reads.
import { restrictedImports, restrictedProperties } from "./lint/boundaries.mjs";

const CORE = ["src/core/**/*.ts", "src/settings/**/*.ts", "src/fusion/**/*.ts"];
const TESTS = ["src/test/**/*.ts", "packages/*/src/**/*.test.ts"];
// Repository tooling: it reads the environment and runs processes, which the boundary rules forbid in the extension.
const TOOLING = [
  "scripts/**",
  "*.config.ts",
  "*.config.mjs",
  ".vscode-test.mjs",
];

export default {
  ignorePatterns: [
    "out/**",
    "dist/**",
    "packages/*/dist/**",
    "webview_panels/**",
    "src/test/fixtures/**",
    "**/*.d.ts",
    "scripts/spikes/**",
    // One-off experiments that regenerate docs/research/evidence; not maintained code.
    "scripts/evidence/**",
  ],
  options: { typeAware: true },
  plugins: ["typescript", "unicorn", "import"],
  jsPlugins: ["@e18e/eslint-plugin"],
  categories: { correctness: "error" },
  rules: {
    "eslint/complexity": "error",
    "eslint/curly": "error",
    "eslint/eqeqeq": "error",
    "eslint/max-depth": "error",
    "eslint/max-lines": [
      "error",
      { max: 400, skipBlankLines: true, skipComments: true },
    ],
    "eslint/max-lines-per-function": [
      "error",
      { max: 80, skipBlankLines: true, skipComments: true },
    ],
    "eslint/max-params": "error",
    "eslint/no-async-promise-executor": "error",
    "eslint/no-throw-literal": "error",
    "eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    "eslint/no-var": "error",
    "eslint/prefer-const": [
      "error",
      { destructuring: "any", ignoreReadBeforeAssign: false },
    ],
    "eslint/prefer-object-has-own": "error",
    "eslint/prefer-rest-params": "error",
    "eslint/prefer-spread": "error",
    "typescript/await-thenable": "error",
    "typescript/ban-ts-comment": [
      "error",
      { "ts-expect-error": "allow-with-description" },
    ],
    "typescript/no-base-to-string": "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-for-in-array": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-misused-spread": "error",
    "typescript/no-non-null-asserted-optional-chain": "error",
    "typescript/no-require-imports": "error",
    "typescript/no-unnecessary-type-assertion": "error",
    "typescript/only-throw-error": "error",
    "typescript/prefer-promise-reject-errors": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/prefer-optional-chain": "error",
    "typescript/prefer-nullish-coalescing": "error",
    "typescript/prefer-includes": "error",
    "typescript/no-deprecated": "error",
    "typescript/consistent-type-imports": [
      "error",
      { fixStyle: "separate-type-imports" },
    ],
    "typescript/parameter-properties": ["error", { prefer: "class-property" }],
    "unicorn/prefer-node-protocol": "error",
    "unicorn/prefer-import-meta-properties": "error",
    "unicorn/prefer-string-replace-all": "error",
    "unicorn/prefer-at": "error",
    "unicorn/prefer-global-this": "error",
    "unicorn/prefer-set-has": "error",
    "unicorn/prefer-optional-catch-binding": "error",
    "e18e/prefer-array-to-sorted": "error",
    "e18e/prefer-array-from-map": "error",
    "e18e/prefer-timer-args": "error",
    "e18e/prefer-regex-test": "error",
    "e18e/prefer-spread-syntax": "error",
    "eslint/no-restricted-properties": restrictedProperties(),
    "eslint/no-restricted-imports": restrictedImports(),
  },
  overrides: [
    {
      files: CORE,
      excludeFiles: TESTS,
      rules: {
        "typescript/no-unsafe-argument": "error",
        "typescript/no-unsafe-assignment": "error",
        "typescript/no-unsafe-call": "error",
        "typescript/no-unsafe-member-access": "error",
        "typescript/no-unsafe-return": "error",
      },
    },
    {
      files: ["src/**/*.ts"],
      excludeFiles: ["src/test/**"],
      rules: { "eslint/no-console": "error" },
    },
    {
      files: ["src/settings/**/*.ts"],
      rules: {
        "eslint/no-restricted-properties": restrictedProperties({
          except: ["settings", "environment", "errorMessage"],
        }),
        "eslint/no-restricted-imports": restrictedImports({
          except: ["environment"],
        }),
      },
    },
    {
      files: [
        "src/projects/output/notifications.ts",
        "src/projects/output/projectErrors.ts",
      ],
      rules: {
        "eslint/no-restricted-properties": restrictedProperties({
          except: ["errorMessage"],
        }),
      },
    },
    {
      files: ["src/fusion/process.ts"],
      rules: {
        "eslint/no-restricted-imports": restrictedImports({
          except: ["process"],
        }),
      },
    },
    {
      files: TOOLING,
      rules: {
        "eslint/no-restricted-properties": "off",
        "eslint/no-restricted-imports": "off",
      },
    },
    {
      files: TESTS,
      rules: {
        "eslint/max-lines": "off",
        "eslint/max-lines-per-function": "off",
        "typescript/no-explicit-any": "off",
        "typescript/no-require-imports": "off",
        "eslint/no-restricted-properties": "off",
        "eslint/no-restricted-imports": "off",
        // `expect(mock.method)` and `vi.mocked(obj.fn)` reference methods without calling them.
        "typescript/unbound-method": "off",
      },
    },
  ],
};
