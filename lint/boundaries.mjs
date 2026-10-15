// Boundary lists shared by the root ESLint config and the root Oxlint config.
// Frozen data plus pure builders. A builder returns a whole rule value, so an exemption block
// re-sets the rule minus the groups it names in `except`; flat config replaces rule options per file.

export const SETTINGS_MESSAGE = "Read settings through src/settings/.";
export const PROCESS_MESSAGE = "Spawn processes through src/fusion/process.ts.";
export const WRITE_MESSAGE =
  "Change user files through WorkspaceEdit; fs writes belong in the extension's storage module.";
export const ENVIRONMENT_MESSAGE =
  "Read the environment through src/settings/.";
export const ERROR_MESSAGE =
  "Error notifications go through notifyError or notifyErrorWithoutProject (src/projects/output/notifications.ts).";
export const POST_MESSAGE =
  "Host messages leave through PanelHost.post or postToWebview (src/webview/panelHost.ts).";
export const REMOVED_MESSAGE =
  "This integration was removed; the extension is local-only and Fusion-only.";
export const VENDOR_MESSAGE =
  "No vendor names or hosted links in shipped strings.";

export const FS_WRITES = Object.freeze([
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
]);

export const SETTINGS_NAMES = "/^(getConfiguration|onDidChangeConfiguration)$/";
const FS_WRITE_NAMES = `/^(${FS_WRITES.join("|")})$/`;

const settingsProperties = ["getConfiguration", "onDidChangeConfiguration"].map(
  (property) => ({
    object: "workspace",
    property,
    message: SETTINGS_MESSAGE,
  }),
);
const environmentProperties = [
  { object: "process", property: "env", message: ENVIRONMENT_MESSAGE },
];
const fsWriteProperties = FS_WRITES.map((property) => ({
  object: "fs",
  property,
  message: WRITE_MESSAGE,
}));
const errorMessageProperties = [
  { object: "window", property: "showErrorMessage", message: ERROR_MESSAGE },
];

const environmentImports = ["process", "node:process"].map((name) => ({
  name,
  importNames: ["env"],
  message: ENVIRONMENT_MESSAGE,
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
  "MemberExpression[object.type='MemberExpression'][object.property.name='workspace']" +
    `[property.name=${SETTINGS_NAMES}]`,
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
// Any identifier named fs*, `fs.promises`, or an aliased promises import, plus VS Code's `workspace.fs`.
const fsWriteCallSyntax = [
  `CallExpression[callee.property.name=${FS_WRITE_NAMES}][callee.object.name=/^(fs|fsp|fsPromises|promises|nodeFs)$/]`,
  `CallExpression[callee.property.name=${FS_WRITE_NAMES}][callee.object.property.name='promises']`,
  "CallExpression[callee.property.name=/^(writeFile|delete|rename|copy|createDirectory)$/]" +
    "[callee.object.property.name='fs'][callee.object.object.name='workspace']",
].map((selector) => ({ selector, message: WRITE_MESSAGE }));
const removedSyntax = [
  "Identifier[name=/^(createPythonBridge|dbtPythonPathOverride|detectPythonFromTerminal|" +
    "dbtCustomRunnerImport|PythonEnvironment|SecretStorage|DBTClient|FusionVersionDetection|" +
    "DBTInstallationVerificationEvent|DBTCoreProjectIntegration|DBTCloudProjectIntegration|" +
    "DBTCoreCommandProjectIntegration|RuntimePythonEnvironment|DBTProjectDetection|DBTDetection)$/]",
  "MemberExpression[property.name='secrets']",
  "Literal[value=/ms-python[.]python|node_python_bridge|altimate_python_packages|" +
    "dbt_core_integration|@altimateai/]",
  "TemplateElement[value.raw=/ms-python[.]python|node_python_bridge|altimate_python_packages|" +
    "dbt_core_integration|@altimateai/]",
].map((selector) => ({ selector, message: REMOVED_MESSAGE }));
export const vendorNameSyntax = [
  "Literal[value=/altimate/i]",
  "TemplateElement[value.raw=/altimate/i]",
].map((selector) => ({ selector, message: VENDOR_MESSAGE }));
const postMessageSyntax = [
  "CallExpression[callee.type='MemberExpression'][callee.property.name='postMessage']",
].map((selector) => ({ selector, message: POST_MESSAGE }));
const removedImports = [{ group: ["@altimateai/*"], message: REMOVED_MESSAGE }];

const PROPERTY_GROUPS = {
  settings: settingsProperties,
  environment: environmentProperties,
  fsWrite: fsWriteProperties,
  errorMessage: errorMessageProperties,
};
const SYNTAX_GROUPS = {
  settings: settingsSyntax,
  process: processSyntax,
  fsRequire: fsRequireSyntax,
  fsWriteCall: fsWriteCallSyntax,
  removed: removedSyntax,
  vendor: vendorNameSyntax,
  postMessage: postMessageSyntax,
};
const IMPORT_GROUPS = {
  process: processImports,
  environment: environmentImports,
  fsWrite: fsWriteImports,
};

// Each builder keeps every group that `except` does not name, in declaration order.
const keep = (groups, except) =>
  Object.entries(groups)
    .filter(([name]) => !except.includes(name))
    .flatMap(([, entries]) => entries);

/** @param {{ except?: string[] }} [options] */
export function restrictedProperties({ except = [] } = {}) {
  return ["error", ...keep(PROPERTY_GROUPS, except)];
}

/** @param {{ except?: string[] }} [options] */
export function restrictedSyntax({ except = [] } = {}) {
  return ["error", ...keep(SYNTAX_GROUPS, except)];
}

/** @param {{ except?: string[] }} [options] */
export function restrictedImports({ except = [] } = {}) {
  return [
    "error",
    { paths: keep(IMPORT_GROUPS, except), patterns: removedImports },
  ];
}
