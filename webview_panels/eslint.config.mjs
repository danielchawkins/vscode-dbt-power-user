import { createRequire } from "node:module";
import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import prettier from "eslint-config-prettier";
import storybook from "eslint-plugin-storybook";
import lodashUnderscore from "eslint-plugin-you-dont-need-lodash-underscore";
import globals from "globals";

const require = createRequire(import.meta.url);
const typescriptRules = require("./eslint/typescript.cjs");

const isPreCommit = process.env.PRE_COMMIT === "true";
const tsFiles = ["**/*.{ts,tsx}"];
const testFiles = ["src/**/*.test.{ts,tsx}", "src/test/**/*.ts"];
const storybookConfigFiles = [".storybook/**/*.{ts,tsx}"];

export default defineConfig(
  {
    ignores: [
      "dist/**",
      "storybook-static/**",
      "eslint/**",
      "eslint.config.mjs",
      "src/lib/altimate/**",
      "**/*.{css,scss,svg}",
    ],
  },
  {
    files: tsFiles,
    ignores: [".storybook/**", ...testFiles],
    extends: [
      js.configs.recommended,
      ...typescriptEslint.configs["flat/recommended-type-checked"],
      ...typescriptEslint.configs["flat/stylistic-type-checked"],
      eslintReact.configs["recommended-typescript"],
      eslintReact.configs["disable-experimental"],
      jsxA11yX.configs.recommended,
      prettier,
    ],
    languageOptions: {
      parser: tsparser,
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
      "you-dont-need-lodash-underscore": lodashUnderscore,
    },
    rules: {
      ...typescriptRules,
      ...lodashUnderscore.configs.compatible.rules,
      "no-console": "error",
      "class-methods-use-this": "off",
      "no-restricted-exports": "off",
      "no-underscore-dangle": "error",
      "no-param-reassign": [
        "warn",
        {
          props: true,
          ignorePropertyModificationsFor: [
            "state",
            "beforeUnloadEvent",
            "acc",
          ],
        },
      ],
      "@typescript-eslint/dot-notation": isPreCommit ? "off" : "warn",
      "@typescript-eslint/no-implied-eval": isPreCommit ? "off" : "error",
      "@typescript-eslint/only-throw-error": isPreCommit ? "off" : "error",
      "@typescript-eslint/return-await": isPreCommit ? "off" : "warn",
      "@typescript-eslint/default-param-last": "off",
      "@eslint-react/dom-no-unsafe-target-blank": "error",
      "@eslint-react/rules-of-hooks": "error",
      "@eslint-react/no-nested-component-definitions": "error",
      "@eslint-react/set-state-in-render": "error",
      "@eslint-react/static-components": "error",
      "@eslint-react/no-unused-props": "warn",
      "@eslint-react/exhaustive-deps": "warn",
      "@eslint-react/set-state-in-effect": "warn",
      "@eslint-react/use-state": "warn",
      "@eslint-react/naming-convention-ref-name": "warn",
      "@eslint-react/purity": "warn",
      "@eslint-react/web-api-no-leaked-event-listener": "warn",
      "@eslint-react/web-api-no-leaked-timeout": "warn",
      "jsx-a11y-x/no-autofocus": "warn",
    },
  },
  {
    files: testFiles,
    extends: [
      js.configs.recommended,
      ...typescriptEslint.configs["flat/recommended"],
      typescriptEslint.configs["flat/disable-type-checked"],
      eslintReact.configs["disable-type-checked"],
      eslintReact.configs["disable-experimental"],
      prettier,
    ],
    languageOptions: {
      parser: tsparser,
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
      "@eslint-react/exhaustive-deps": "warn",
    },
  },
  {
    files: storybookConfigFiles,
    extends: [
      ...typescriptEslint.configs["flat/recommended"],
      typescriptEslint.configs["flat/disable-type-checked"],
      eslintReact.configs["disable-type-checked"],
      eslintReact.configs["disable-experimental"],
      ...storybook.configs["flat/recommended"],
    ],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
  },
  ...storybook.configs["flat/recommended"],
  {
    files: ["src/modules/**"],
    ignores: testFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "reactstrap",
              message: "Use `@uicore`",
            },
          ],
          patterns: [],
        },
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
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
