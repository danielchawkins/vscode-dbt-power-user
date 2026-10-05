const tseslint = require("typescript-eslint");
const sonarjs = require("eslint-plugin-sonarjs");
const prettier = require("eslint-config-prettier/flat");

// Violations present when a rule was introduced live in eslint-suppressions.json; new ones fail `just lint`.
// Fixing one requires `npm run lint:prune` so the baseline only ever shrinks.

// Flat config replaces rule options per file, so an exemption re-sets the whole rule minus its own entries.
const SETTINGS_MESSAGE = "Read settings through src/settings/.";
const PROCESS_MESSAGE = "Spawn processes through src/fusion/process.ts.";
const WRITE_MESSAGE =
  "Change user files through WorkspaceEdit; fs writes belong in the extension's storage module.";
const FS_WRITES = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "unlink",
  "unlinkSync",
  "rename",
  "renameSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
  "createWriteStream",
  "truncate",
  "truncateSync",
  "mkdir",
  "mkdirSync",
  "symlink",
  "symlinkSync",
];
const SETTINGS_NAMES = "/^(getConfiguration|onDidChangeConfiguration)$/";
const settingsProperties = ["getConfiguration", "onDidChangeConfiguration"].map(
  (property) => ({
    object: "workspace",
    property,
    message: SETTINGS_MESSAGE,
  }),
);
const ENVIRONMENT_MESSAGE = "Read the environment through src/settings/.";
const environmentProperties = [
  { object: "process", property: "env", message: ENVIRONMENT_MESSAGE },
];
const environmentImports = ["process", "node:process"].map((name) => ({
  name,
  importNames: ["env"],
  message: ENVIRONMENT_MESSAGE,
}));
const fsWriteProperties = FS_WRITES.map((property) => ({
  object: "fs",
  property,
  message: WRITE_MESSAGE,
}));
const processImports = ["child_process", "node:child_process"].map((name) => ({
  name,
  message: PROCESS_MESSAGE,
}));
const fsWriteImports = [
  ...["fs", "node:fs"].map((name) => ({
    name,
    importNames: ["default", "promises", ...FS_WRITES],
  })),
  ...["fs/promises", "node:fs/promises"].map((name) => ({
    name,
    importNames: FS_WRITES,
  })),
].map((path) => ({ ...path, message: WRITE_MESSAGE }));
const settingsSyntax = [
  `MemberExpression[object.type='MemberExpression'][object.property.name='workspace'][property.name=${SETTINGS_NAMES}]`,
  `MemberExpression[object.name='workspace'][computed=true][property.value=${SETTINGS_NAMES}]`,
  `VariableDeclarator[init.name='workspace'] > ObjectPattern > Property[key.name=${SETTINGS_NAMES}]`,
  `VariableDeclarator[init.property.name='workspace'] > ObjectPattern > Property[key.name=${SETTINGS_NAMES}]`,
].map((selector) => ({ selector, message: SETTINGS_MESSAGE }));
const processSyntax = [
  "ImportExpression[source.value=/^(node:)?child_process$/]",
  "CallExpression[callee.name='require'][arguments.0.value=/^(node:)?child_process$/]",
].map((selector) => ({ selector, message: PROCESS_MESSAGE }));
const fsRequireSyntax = [
  {
    selector:
      "CallExpression[callee.name='require'][arguments.0.value=/^(node:)?(fs|fs\\/promises)$/]",
    message: WRITE_MESSAGE,
  },
];
const REMOVED_MESSAGE =
  "This integration was removed; the extension is local-only and Fusion-only.";
const removedSyntax = [
  "Identifier[name=/^(createPythonBridge|dbtPythonPathOverride|detectPythonFromTerminal|dbtCustomRunnerImport|PythonEnvironment|SecretStorage|DBTClient|FusionVersionDetection|DBTInstallationVerificationEvent|DBTCoreProjectIntegration|DBTCloudProjectIntegration|DBTCoreCommandProjectIntegration|RuntimePythonEnvironment|DBTProjectDetection|DBTDetection)$/]",
  "MemberExpression[property.name='secrets']",
  "Literal[value=/ms-python[.]python|node_python_bridge|altimate_python_packages|dbt_core_integration|@altimateai/]",
  "TemplateElement[value.raw=/ms-python[.]python|node_python_bridge|altimate_python_packages|dbt_core_integration|@altimateai/]",
].map((selector) => ({ selector, message: REMOVED_MESSAGE }));
const removedImports = [{ group: ["@altimateai/*"], message: REMOVED_MESSAGE }];
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

module.exports = [
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
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
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
      "no-restricted-properties": [
        "error",
        ...settingsProperties,
        ...environmentProperties,
        ...fsWriteProperties,
      ],
      "no-restricted-syntax": [
        "error",
        ...settingsSyntax,
        ...processSyntax,
        ...fsRequireSyntax,
        ...removedSyntax,
      ],
      "@typescript-eslint/no-require-imports": "error",
      "no-restricted-imports": [
        "error",
        {
          paths: [...processImports, ...environmentImports, ...fsWriteImports],
          patterns: removedImports,
        },
      ],
    },
  },
  {
    files: ["src/settings/**/*.ts"],
    rules: {
      "no-restricted-properties": ["error", ...fsWriteProperties],
      "no-restricted-syntax": [
        "error",
        ...processSyntax,
        ...fsRequireSyntax,
        ...removedSyntax,
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [...processImports, ...fsWriteImports],
          patterns: removedImports,
        },
      ],
    },
  },
  {
    files: ["src/fusion/process.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...settingsSyntax,
        ...fsRequireSyntax,
        ...removedSyntax,
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [...environmentImports, ...fsWriteImports],
          patterns: removedImports,
        },
      ],
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
