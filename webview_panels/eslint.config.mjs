import eslintReact from "@eslint-react/eslint-plugin";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import reactRefresh from "eslint-plugin-react-refresh";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig } from "eslint/config";
import globals from "globals";
import { createRequire } from "node:module";
import tseslint from "typescript-eslint";

const require = createRequire(import.meta.url);
const typescriptRules = require("./eslint/typescript.cjs");

const tsFiles = ["**/*.{ts,tsx}"];
const testFiles = ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"];

// Only the request executor posts to the host; every other file sends through its panel's requests module.
const vscodeApiMessage = "Send through the panel's requests module.";
const vscodeApiPaths = [{ name: "@vscodeApi", message: vscodeApiMessage }];
const vscodeApiPatterns = [
  {
    regex: "^(\\.{1,2}/(.*/)?|@modules/)vscode(/index(\\.ts)?)?$",
    message: vscodeApiMessage,
  },
];

// Violations present when a rule was introduced live in eslint-suppressions.json; new ones fail `just lint`.
// Fixing one requires `npm run lint:prune` so the baseline only ever shrinks.

export default defineConfig(
  {
    ignores: [
      "dist/**",
      "eslint/**",
      "eslint.config.mjs",
      "src/lib/altimate/**",
      "**/*.{css,scss,svg}",
    ],
  },
  {
    files: tsFiles,
    ignores: testFiles,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      eslintReact.configs["recommended-typescript"],
      eslintReact.configs["disable-experimental"],
      jsxA11yX.configs.recommended,
      prettier,
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        extraFileExtensions: [".json"],
        sourceType: "module",
        project: ["./tsconfig.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        JSX: "readonly",
      },
    },
    settings: {
      "jsx-a11y-x": {
        components: {
          Stack: "div",
        },
      },
    },
    plugins: {
      "@eslint-react": eslintReact,
    },
    rules: {
      ...typescriptRules,
      "no-console": "error",
      "no-async-promise-executor": "error",
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-misused-spread": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": "allow-with-description" },
      ],
      "class-methods-use-this": "off",
      "no-restricted-exports": "off",
      "no-underscore-dangle": "error",
      "no-param-reassign": [
        "error",
        {
          props: true,
          ignorePropertyModificationsFor: ["state", "beforeUnloadEvent", "acc"],
        },
      ],
      "@typescript-eslint/dot-notation": "error",
      "@typescript-eslint/no-implied-eval": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/return-await": "error",
      "@typescript-eslint/default-param-last": "off",
      "@eslint-react/dom-no-unsafe-target-blank": "error",
      "@eslint-react/rules-of-hooks": "error",
      "@eslint-react/no-nested-component-definitions": "error",
      "@eslint-react/set-state-in-render": "error",
      "@eslint-react/static-components": "error",
      "@eslint-react/no-unused-props": "error",
      "@eslint-react/exhaustive-deps": "error",
      "@eslint-react/set-state-in-effect": "error",
      "@eslint-react/use-state": "error",
      "@eslint-react/naming-convention-ref-name": "error",
      "@eslint-react/purity": "error",
      "@eslint-react/web-api-no-leaked-event-listener": "error",
      "@eslint-react/web-api-no-leaked-timeout": "error",
      "jsx-a11y-x/no-autofocus": "error",
    },
  },
  {
    // A panel sends only through its typed request functions, which accept that panel's `PanelMessage` union.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/app/requestExecutor.ts", ...testFiles],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='postMessage']:not([callee.object.name='window'])",
          message: "Send through the panel's requests module.",
        },
      ],
    },
  },
  {
    files: testFiles,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      tseslint.configs.disableTypeChecked,
      eslintReact.configs["disable-type-checked"],
      eslintReact.configs["disable-experimental"],
      prettier,
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        JSX: "readonly",
      },
    },
    plugins: {
      "@eslint-react": eslintReact,
    },
    rules: {
      "@eslint-react/rules-of-hooks": "error",
      "@eslint-react/exhaustive-deps": "error",
    },
  },
  {
    files: ["src/modules/**"],
    ignores: [
      "src/modules/app/requestExecutor.ts",
      "src/modules/app/viewState.ts",
      ...testFiles,
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: vscodeApiPaths,
          patterns: vscodeApiPatterns,
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/**", ...testFiles],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: vscodeApiPaths, patterns: vscodeApiPatterns },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: testFiles,
    plugins: {
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-refresh/only-export-components": [
        "error",
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: testFiles,
    plugins: { sonarjs },
    rules: {
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
      "max-lines": [
        "error",
        { max: 600, skipBlankLines: true, skipComments: true },
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
    },
  },
);
