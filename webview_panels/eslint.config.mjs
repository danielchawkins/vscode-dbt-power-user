import eslintReact from "@eslint-react/eslint-plugin";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import oxlint from "eslint-plugin-oxlint";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

// Scoped and untyped (D10, D11): only the rules Oxlint can't host natively. No type-aware parser options.
// Violations present when a rule was introduced live in eslint-suppressions.json; new ones fail `just lint`.
// Fixing one requires `just lint-prune` so the baseline only ever shrinks.

const SOURCE_FILES = ["src/**/*.{ts,tsx}"];
const testFiles = ["src/**/*.test.{ts,tsx}", "src/test/**/*.{ts,tsx}"];

// Only the request executor posts to the host; every other file sends through its panel's requests module.
const POST_MESSAGE = "Send through the panel's requests module.";
const VENDOR_MESSAGE = "No vendor names or hosted links in shipped strings.";

const ESLINT_RULES = {
  "@eslint-react/dom-no-dangerously-set-innerhtml": "warn",
  "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
  "@eslint-react/dom-no-flush-sync": "error",
  "@eslint-react/dom-no-hydrate": "error",
  "@eslint-react/dom-no-render": "error",
  "@eslint-react/dom-no-script-url": "warn",
  "@eslint-react/dom-no-unsafe-iframe-sandbox": "warn",
  "@eslint-react/dom-no-unsafe-target-blank": "error",
  "@eslint-react/dom-no-use-form-state": "error",
  "@eslint-react/dom-no-void-elements-with-children": "error",
  "@eslint-react/jsx-no-children-prop-with-children": "error",
  "@eslint-react/jsx-no-key-after-spread": "error",
  "@eslint-react/jsx-no-leaked-dollar": "warn",
  "@eslint-react/jsx-no-leaked-semicolon": "warn",
  "@eslint-react/naming-convention-context-name": "warn",
  "@eslint-react/naming-convention-id-name": "warn",
  "@eslint-react/naming-convention-ref-name": "error",
  "@eslint-react/no-access-state-in-setstate": "error",
  "@eslint-react/no-children-count": "warn",
  "@eslint-react/no-children-for-each": "warn",
  "@eslint-react/no-children-map": "warn",
  "@eslint-react/no-children-only": "warn",
  "@eslint-react/no-children-to-array": "warn",
  "@eslint-react/no-component-will-mount": "error",
  "@eslint-react/no-component-will-receive-props": "error",
  "@eslint-react/no-component-will-update": "error",
  "@eslint-react/no-context-provider": "warn",
  "@eslint-react/no-create-ref": "error",
  "@eslint-react/no-forward-ref": "warn",
  "@eslint-react/no-missing-key": "error",
  "@eslint-react/no-nested-component-definitions": "error",
  "@eslint-react/no-nested-lazy-component-declarations": "error",
  "@eslint-react/no-set-state-in-component-did-mount": "warn",
  "@eslint-react/no-set-state-in-component-did-update": "warn",
  "@eslint-react/no-set-state-in-component-will-update": "warn",
  "@eslint-react/no-unnecessary-use-prefix": "warn",
  "@eslint-react/no-unsafe-component-will-mount": "warn",
  "@eslint-react/no-unsafe-component-will-receive-props": "warn",
  "@eslint-react/no-unsafe-component-will-update": "warn",
  "@eslint-react/no-unused-class-component-members": "warn",
  "@eslint-react/no-use-context": "warn",
  "@eslint-react/use-state": [
    "error",
    {
      enforceAssignment: true,
      enforceLazyInitialization: true,
      enforceSetterName: true,
    },
  ],
  "@eslint-react/web-api-no-leaked-event-listener": "error",
  "@eslint-react/web-api-no-leaked-intersection-observer": "warn",
  "@eslint-react/web-api-no-leaked-interval": "warn",
  "@eslint-react/web-api-no-leaked-resize-observer": "warn",
  "@eslint-react/web-api-no-leaked-timeout": "error",
  "@typescript-eslint/naming-convention": [
    "error",
    {
      selector: "variable",
      format: ["camelCase", "PascalCase", "UPPER_CASE"],
      filter: { regex: "_id", match: false },
    },
    { selector: "function", format: ["camelCase"] },
    { selector: "typeLike", format: ["PascalCase"] },
  ],
  "no-octal": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector:
        "CallExpression[callee.property.name='postMessage']:not([callee.object.name='window'])",
      message: POST_MESSAGE,
    },
    {
      selector: "Literal[value=/altimate/i]",
      message: VENDOR_MESSAGE,
    },
    {
      selector: "TemplateElement[value.raw=/altimate/i]",
      message: VENDOR_MESSAGE,
    },
  ],
  "sonarjs/cognitive-complexity": ["error", 15],
  "sonarjs/no-collapsible-if": "error",
  "sonarjs/no-duplicated-branches": "error",
  "sonarjs/no-identical-functions": ["error", 3],
  "sonarjs/no-inverted-boolean-check": "error",
  "sonarjs/prefer-single-boolean-return": "error",
};

export default defineConfig(
  {
    ignores: [
      ".cache/**",
      "dist/**",
      "eslint/**",
      "eslint.config.mjs",
      "lint/**",
      "oxlint.config.ts",
      "src/lib/altimate/**",
      "**/*.{css,scss,svg}",
    ],
  },
  {
    files: SOURCE_FILES,
    ignores: testFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    settings: {
      "jsx-a11y-x": {
        components: {
          Stack: "div",
        },
      },
    },
    plugins: {
      "@eslint-react": eslintReact,
      "jsx-a11y-x": jsxA11yX,
      "@typescript-eslint": tseslint.plugin,
      sonarjs,
    },
    rules: ESLINT_RULES,
  },
  {
    // The request executor is the one file that posts to the host.
    files: ["src/modules/app/requestExecutor.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Turns off every rule Oxlint runs, so nothing is reported twice. It must stay last (O10).
  ...oxlint.configs["flat/all"],
);
