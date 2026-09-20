const { FlatCompat } = require("@eslint/eslintrc");
const js = require("@eslint/js");
const reactRefresh = require("eslint-plugin-react-refresh").default;
const typescriptRules = require("./eslint/typescript.cjs");

const isPreCommit = process.env.PRE_COMMIT === "true";
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  {
    ignores: [
      "dist/**",
      ".storybook/**",
      "src/lib/altimate/**",
      "**/*.{css,scss,svg}",
    ],
  },
  ...compat.config({
    env: { browser: true, es2020: true },
    extends: [
      "eslint:recommended",
      "plugin:react/recommended",
      "plugin:react/jsx-runtime",
      "plugin:@typescript-eslint/recommended-type-checked",
      "plugin:@typescript-eslint/stylistic-type-checked",
      "prettier",
      "plugin:you-dont-need-lodash-underscore/compatible",
      "plugin:storybook/recommended",
    ],
    parser: "@typescript-eslint/parser",
    settings: {
      react: {
        version: "detect",
      },
    },
    parserOptions: {
      ecmaVersion: "latest",
      extraFileExtensions: [".json"],
      sourceType: "module",
      project: ["./tsconfig.json", "./tsconfig.node.json"],
      tsconfigRootDir: __dirname,
      ecmaFeatures: {
        jsx: true,
      },
    },
    plugins: [
      "react",
      "@typescript-eslint",
      "jest",
      "testing-library",
      "promise",
    ],
    rules: {
      ...typescriptRules,
      "no-console": "error",
      "class-methods-use-this": "off",
      "import/no-extraneous-dependencies": "off",
      "import/extensions": "off",
      "import/no-default-export": "off",
      "import/prefer-default-export": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/require-default-props": "off",
      "react/jsx-no-target-blank": ["error", { allowReferrer: false }],
      "react/jsx-props-no-spreading": "off",
      "react/no-unused-prop-types": "warn",
      "@typescript-eslint/dot-notation": isPreCommit ? "off" : "warn",
      "@typescript-eslint/no-implied-eval": isPreCommit ? "off" : "error",
      "@typescript-eslint/only-throw-error": isPreCommit ? "off" : "error",
      "@typescript-eslint/return-await": isPreCommit ? "off" : "warn",
      "@typescript-eslint/default-param-last": "off",
      "no-restricted-exports": "off",
      "no-underscore-dangle": ["error"],
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
      "react/function-component-definition": [
        "error",
        {
          namedComponents: "arrow-function",
          unnamedComponents: "arrow-function",
        },
      ],
    },
    overrides: [
      {
        files: ["src/modules/**"],
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
    ],
  }).map((config) =>
    config.files ? config : { ...config, files: ["**/*.{ts,tsx}"] },
  ),
  {
    files: ["src/**/*.{ts,tsx}"],
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
];
