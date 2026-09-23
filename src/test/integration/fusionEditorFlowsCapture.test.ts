import * as assert from "assert";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture, LspFixture } from "./lspFixture";
import { LspRequestError } from "./lspProtocolClient";

const CAPTURE_ENABLED = process.env.FPU_RUN_EDITOR_FLOW_CAPTURE === "1";
const COMMAND_PREFIX = "fpu-editor-flow-capture:";
const REQUEST_MS = 12_000;
const SYNC_ACK_MS = 10_000;
const PER_ARM_BUDGET_MS = 75_000;
const SUITE_TIMEOUT_MS = PER_ARM_BUDGET_MS * 6 + 60_000;
const TARGET_SETTLE_MS = 500;
type ArmId = "A" | "B" | "C";
type OutcomeKind = "ok" | "null" | "empty" | "error" | "timeout";

interface RequestOutcome<T = unknown> {
  kind: OutcomeKind;
  lspErrorCode?: number;
  timeoutMethod?: string;
  requestFailed?: boolean;
  value?: T;
}

interface PreflightOutcome {
  depsExit: number;
  parseExit: number;
}

interface TargetFileSnapshot {
  relativePath: string;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
  sha256?: string;
}

interface ProgressRecord {
  title: string;
  message: string;
  kind: string;
}

interface DiagnosticSummary {
  relativeUri: string;
  severity: number;
  codeClass: string;
}

interface FlowCapture {
  completion: RequestOutcome<{ labels: string[] }>;
  hoverPackageQualifier: RequestOutcome<{ contentClass: string }>;
  hoverPackageMacro: RequestOutcome<{ contentClass: string }>;
  definition: RequestOutcome<{ matchesExpected: boolean }>;
  prepareRename: RequestOutcome<{ accepts: boolean; shape: string }>;
  rename: RequestOutcome<{ editFileCount: number; relativeFiles: string[] }>;
  formatting: RequestOutcome<{ editCount: number }>;
  brokenRefPush: {
    absoluteTotal: number;
    absoluteSummaries: DiagnosticSummary[];
    sinceCursorCount: number;
    summaries: DiagnosticSummary[];
  };
  brokenRefPull: RequestOutcome<{ count: number }>;
  lintCodeAction: RequestOutcome<{
    offered: boolean;
    actionShape: string;
    diagnosticsPassed: number;
    diagnosticRelativeUri: string;
    exercised: boolean;
  }>;
  getProjectInfo: RequestOutcome<{ shape: string }>;
  flowProgress: ProgressRecord[];
  pullDiagnosticsAvailable: boolean;
  textDocumentSyncShape: string;
  renameProviderAdvertised: boolean;
  configurationRequestSections: string[];
  configurationDeliveredSections: string[];
  protocolErrors: number;
}

interface ArmCapture {
  arm: ArmId;
  preflight: PreflightOutcome;
  triggerProgress: ProgressRecord[];
  targetSnapshots: {
    afterOpen: TargetFileSnapshot[];
    beforeCompileLsp: TargetFileSnapshot[] | null;
    afterCompileLsp: TargetFileSnapshot[] | null;
  };
  flows: FlowCapture;
}

function fileUri(fsPath: string): string {
  return pathToFileURL(fsPath).href;
}

function relativeUri(projectRoot: string, uri: string): string {
  const filePath = uri.startsWith("file:") ? fileURLToPath(uri) : uri;
  const resolvedProject = path.resolve(projectRoot);
  const resolvedFile = path.resolve(filePath);
  if (
    resolvedFile === resolvedProject ||
    resolvedFile.startsWith(`${resolvedProject}${path.sep}`)
  ) {
    return path.relative(resolvedProject, resolvedFile);
  }
  const suffix = resolvedFile.match(/(?:models|macros|vendor)\/.+$/)?.[0];
  return suffix ?? path.basename(resolvedFile);
}

function prefixedCommand(base: string): string {
  return `${COMMAND_PREFIX}${base}`;
}

async function classifiedRequest<T>(
  fixture: LspFixture,
  method: string,
  params: unknown,
  timeoutMs: number,
  classify: (value: T) => OutcomeKind,
): Promise<RequestOutcome<T>> {
  try {
    const value = await fixture.request<T>(method, params, timeoutMs);
    if (value === null || value === undefined) {
      return { kind: "null" };
    }
    const kind = classify(value);
    return { kind, value };
  } catch (error) {
    if (error instanceof LspRequestError) {
      return { kind: "error", lspErrorCode: error.code };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("timed out after")) {
      return { kind: "timeout", timeoutMethod: method };
    }
    return { kind: "error", requestFailed: true };
  }
}

function hoverContentClass(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return "none";
  }
  const contents = (result as { contents?: unknown }).contents;
  if (typeof contents === "string") {
    return contents.length > 0 ? "string" : "empty-string";
  }
  if (Array.isArray(contents)) {
    return contents.length > 0 ? "markup-array" : "empty-array";
  }
  if (typeof contents === "object" && contents !== null) {
    const value = (contents as { value?: string }).value ?? "";
    return value.length > 0 ? "markup" : "empty-markup";
  }
  return "none";
}

function definitionUri(result: unknown): string | undefined {
  const locations = Array.isArray(result)
    ? result
    : result !== null && typeof result === "object"
      ? [result]
      : [];
  for (const location of locations) {
    if (typeof location !== "object" || location === null) {
      continue;
    }
    const direct = (location as { uri?: string }).uri;
    if (typeof direct === "string") {
      return direct;
    }
    const target = (location as { targetUri?: string }).targetUri;
    if (typeof target === "string") {
      return target;
    }
  }
  return undefined;
}

function formattingEditCount(result: unknown): number {
  return Array.isArray(result) ? result.length : 0;
}

function prepareRenameAccepts(result: unknown): {
  accepts: boolean;
  shape: string;
} {
  if (result === null) {
    return { accepts: false, shape: "null" };
  }
  if (typeof result !== "object") {
    return { accepts: false, shape: "non-object" };
  }
  if ("defaultBehavior" in result) {
    return { accepts: true, shape: "defaultBehavior" };
  }
  if ("range" in result) {
    return { accepts: true, shape: "range-wrapper" };
  }
  if ("start" in result && "end" in result) {
    return { accepts: true, shape: "bare-range" };
  }
  return { accepts: false, shape: "unknown-object" };
}

function codeActionLintFix(result: unknown): {
  offered: boolean;
  actionShape: string;
} {
  if (!Array.isArray(result)) {
    return { offered: false, actionShape: "non-array" };
  }
  if (result.length === 0) {
    return { offered: false, actionShape: "empty-array" };
  }
  const shapes = result.map((action) => {
    if (typeof action !== "object" || action === null) {
      return "unknown";
    }
    const kind = (action as { kind?: string }).kind ?? "";
    const command = (action as { command?: unknown }).command;
    const commandId =
      typeof command === "object" && command !== null
        ? String((command as { command?: string }).command ?? "")
        : "";
    const lintKind =
      kind === "source.fixAll.dbtLintFix" || kind.endsWith(".dbtLintFix");
    const lintCommand =
      commandId.includes("dbtLintFix") || commandId.includes("lintFix");
    if (lintKind && command !== undefined) {
      return "lint-codeAction-with-command";
    }
    if (lintKind) {
      return "lint-codeAction";
    }
    if (lintCommand) {
      return "lint-command";
    }
    if (command !== undefined) {
      return "command";
    }
    if (kind.length > 0) {
      return "other-kind";
    }
    return "other";
  });
  const offered = shapes.some(
    (shape) =>
      shape === "lint-codeAction" ||
      shape === "lint-codeAction-with-command" ||
      shape === "lint-command",
  );
  return { offered, actionShape: [...new Set(shapes)].join("|") };
}

function diagnosticCodeClass(diag: unknown): string {
  if (typeof diag !== "object" || diag === null) {
    return "none";
  }
  const code = (diag as { code?: unknown }).code;
  if (typeof code === "number") {
    return `number:${code}`;
  }
  if (typeof code === "string") {
    return `string:${code.length > 0 ? "present" : "empty"}`;
  }
  if (typeof code === "object" && code !== null) {
    return "object";
  }
  return "none";
}

function progressRecord(params: unknown): ProgressRecord {
  if (typeof params !== "object" || params === null) {
    return { title: "", message: "", kind: "" };
  }
  const value = (
    params as { value?: { title?: string; message?: string; kind?: string } }
  ).value;
  return {
    title: value?.title ?? "",
    message: value?.message ?? "",
    kind: value?.kind ?? "",
  };
}

function collectProgress(
  fixture: LspFixture,
  fromCursor: number,
): ProgressRecord[] {
  return fixture
    .getNotificationsSince("$/progress", fromCursor)
    .map((params) => progressRecord(params))
    .filter(
      (entry) =>
        entry.title.length > 0 ||
        entry.message.length > 0 ||
        entry.kind.length > 0,
    );
}

function snapshotTargetPaths(projectRoot: string): TargetFileSnapshot[] {
  const watched: string[] = ["target/manifest.json"];
  const compiledRoot = path.join(projectRoot, "target", "compiled");
  if (fs.existsSync(compiledRoot)) {
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else {
          watched.push(path.relative(projectRoot, fullPath));
        }
      }
    };
    walk(compiledRoot);
  }

  return watched.sort().map((relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return { relativePath, exists: false };
    }
    const stat = fs.statSync(absolutePath);
    const data = fs.readFileSync(absolutePath);
    return {
      relativePath,
      exists: true,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: createHash("sha256").update(data).digest("hex"),
    };
  });
}

function targetWriteEvidence(
  before: TargetFileSnapshot[],
  after: TargetFileSnapshot[],
): {
  changedPaths: string[];
  newlyPresent: string[];
  removedPaths: string[];
  hashChanged: string[];
} {
  const beforeByPath = new Map(
    before.map((entry) => [entry.relativePath, entry]),
  );
  const afterByPath = new Map(
    after.map((entry) => [entry.relativePath, entry]),
  );
  const changedPaths: string[] = [];
  const newlyPresent: string[] = [];
  const removedPaths: string[] = [];
  const hashChanged: string[] = [];
  for (const entry of after) {
    const prior = beforeByPath.get(entry.relativePath);
    if (!prior?.exists && entry.exists) {
      newlyPresent.push(entry.relativePath);
    }
    if (prior?.exists && entry.exists) {
      if (prior.size !== entry.size || prior.mtimeMs !== entry.mtimeMs) {
        changedPaths.push(entry.relativePath);
      }
      if (prior.sha256 !== entry.sha256) {
        hashChanged.push(entry.relativePath);
      }
    }
  }
  for (const [relativePath, prior] of beforeByPath) {
    const next = afterByPath.get(relativePath);
    if (prior.exists && !next?.exists) {
      removedPaths.push(relativePath);
    }
  }
  return {
    changedPaths: changedPaths.sort(),
    newlyPresent: newlyPresent.sort(),
    removedPaths: removedPaths.sort(),
    hashChanged: hashChanged.sort(),
  };
}

function endPosition(text: string): { line: number; character: number } {
  const lines = text.split("\n");
  const line = Math.max(lines.length - 1, 0);
  return { line, character: lines[line]?.length ?? 0 };
}

function summarizeDiagnostics(
  projectRoot: string,
  entries: Array<{
    uri: string;
    severity: number;
    codeClass: string;
  }>,
): DiagnosticSummary[] {
  return entries.map((entry) => ({
    relativeUri: relativeUri(projectRoot, entry.uri),
    severity: entry.severity,
    codeClass: entry.codeClass,
  }));
}

function prepareEditorFlowProject(tempRoot: string): void {
  const modelsDir = path.join(tempRoot, "models");
  for (const stale of ["broken_ref.sql"]) {
    const stalePath = path.join(modelsDir, stale);
    if (fs.existsSync(stalePath)) {
      fs.unlinkSync(stalePath);
    }
  }

  const pkgRoot = path.join(tempRoot, "vendor", "editor_flow_pkg");
  fs.mkdirSync(path.join(pkgRoot, "macros"), { recursive: true });
  fs.writeFileSync(
    path.join(pkgRoot, "dbt_project.yml"),
    ["name: editor_flow_pkg", "version: 1.0.0", "config-version: 2", ""].join(
      "\n",
    ),
  );
  fs.writeFileSync(
    path.join(pkgRoot, "macros", "packaged_macro.sql"),
    "{% macro packaged_macro() %} select 1 as pkg_id {% endmacro %}\n",
  );
  fs.writeFileSync(
    path.join(tempRoot, "packages.yml"),
    ["packages:", "  - local: vendor/editor_flow_pkg", ""].join("\n"),
  );

  fs.writeFileSync(
    path.join(modelsDir, "base.sql"),
    "select 1 as id, 'a' as name\n",
  );
  fs.writeFileSync(
    path.join(modelsDir, "child.sql"),
    "select id, name from {{ ref('base') }}\n",
  );
  fs.writeFileSync(
    path.join(modelsDir, "completion_probe.sql"),
    "select * from {{ ref('base') }}\n",
  );
  fs.writeFileSync(
    path.join(modelsDir, "diagnostic_model.sql"),
    "select 1 as ok_column\n",
  );
  fs.writeFileSync(path.join(modelsDir, "lintable.sql"), "select 1");
  fs.writeFileSync(
    path.join(modelsDir, "format_me.sql"),
    "SELECT id,name FROM base\n",
  );
  fs.writeFileSync(
    path.join(modelsDir, "pkg_macro_user.sql"),
    "select * from {{ editor_flow_pkg.packaged_macro() }}\n",
  );
  fs.writeFileSync(
    path.join(modelsDir, "schema.yml"),
    [
      "version: 2",
      "models:",
      "  - name: base",
      "    columns:",
      "      - name: id",
      "        description: Base identifier",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(tempRoot, ".sqlfluff"),
    ["[sqlfluff]", "dialect = duckdb", "templater = jinja", ""].join("\n"),
  );
}

function runPreflight(projectRoot: string): PreflightOutcome {
  const common = [
    "--project-dir",
    projectRoot,
    "--profiles-dir",
    projectRoot,
    "--profile",
    "single_project",
    "--target",
    "test",
    "--no-version-check",
  ];
  const deps = spawnSync("dbt", ["deps", ...common], {
    encoding: "utf-8",
    timeout: 120_000,
  });
  const parse = spawnSync("dbt", ["parse", ...common], {
    encoding: "utf-8",
    timeout: 120_000,
  });
  return {
    depsExit: deps.status ?? 1,
    parseExit: parse.status ?? 1,
  };
}

function textDocumentSyncShape(capabilities: Record<string, unknown>): string {
  const sync = capabilities.textDocumentSync;
  if (typeof sync === "number") {
    return `numeric:${sync}`;
  }
  if (typeof sync === "object" && sync !== null) {
    const change = (sync as { change?: number }).change;
    const openClose = (sync as { openClose?: boolean }).openClose;
    return `object:change=${change ?? "?"}:openClose=${openClose ?? "?"}`;
  }
  return "unknown";
}

function initializeCapabilities(): Record<string, unknown> {
  return {
    window: { workDoneProgress: true },
    workspace: {
      configuration: true,
      didChangeWatchedFiles: { dynamicRegistration: true },
    },
    textDocument: {
      synchronization: { dynamicRegistration: true, willSave: true },
      completion: {
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
        },
      },
      hover: { contentFormat: ["markdown", "plaintext"] },
      definition: { linkSupport: true },
      references: {},
      documentSymbol: {},
      codeAction: {
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: ["quickfix", "source.fixAll", "source.fixAll.dbtLintFix"],
          },
        },
      },
      formatting: {},
      rename: { prepareSupport: true },
      publishDiagnostics: { relatedInformation: true },
      diagnostic: {
        dynamicRegistration: true,
        relatedDocumentSupport: true,
      },
    },
  };
}

async function waitForDocumentAck(
  fixture: LspFixture,
  uri: string,
  verb: "Did open" | "Did change" | "Did save",
  timeoutMs: number,
): Promise<void> {
  await fixture.waitForNotification(
    "window/logMessage",
    (params) => {
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const message = (params as { message?: string }).message ?? "";
      return message.includes(`${verb}:`) && message.includes(uri);
    },
    timeoutMs,
  );
}

async function applyDocumentChange(
  fixture: LspFixture,
  uri: string,
  version: number,
  previousText: string,
  newText: string,
  syncShape: string,
  documentVersions: Map<string, number>,
): Promise<number> {
  const nextVersion = version + 1;
  const incremental = syncShape.includes("change=2");
  fixture.notify("textDocument/didChange", {
    textDocument: { uri, version: nextVersion },
    contentChanges: incremental
      ? [
          {
            range: {
              start: { line: 0, character: 0 },
              end: endPosition(previousText),
            },
            text: newText,
          },
        ]
      : [{ text: newText }],
  });
  await waitForDocumentAck(fixture, uri, "Did change", SYNC_ACK_MS);
  documentVersions.set(uri, nextVersion);
  return nextVersion;
}

function parseDiagnostics(params: unknown): Array<{
  uri: string;
  severity: number;
  codeClass: string;
  full: unknown;
}> {
  if (typeof params !== "object" || params === null) {
    return [];
  }
  const uri = (params as { uri?: string }).uri ?? "";
  const diags = (params as { diagnostics?: unknown[] }).diagnostics;
  if (!Array.isArray(diags)) {
    return [];
  }
  return diags.map((diag) => ({
    uri,
    severity:
      typeof diag === "object" && diag !== null
        ? ((diag as { severity?: number }).severity ?? 0)
        : 0,
    codeClass: diagnosticCodeClass(diag),
    full: diag,
  }));
}

function extractConfigurationSections(
  fixture: LspFixture,
  fromCursor: number,
): string[] {
  return [
    ...new Set(
      fixture
        .getServerRequestsSince("workspace/configuration", fromCursor)
        .flatMap((entry) => {
          if (typeof entry.params !== "object" || entry.params === null) {
            return [];
          }
          const items = (entry.params as { items?: unknown[] }).items ?? [];
          return items
            .map((item) =>
              typeof item === "object" && item !== null
                ? (item as { section?: string }).section
                : undefined,
            )
            .filter(
              (section): section is string => typeof section === "string",
            );
        }),
    ),
  ].sort();
}

function extractDeliveredConfigurationSections(
  fixture: LspFixture,
  fromCursor: number,
): string[] {
  return [
    ...new Set(
      fixture
        .getConfigurationDeliveriesSince(fromCursor)
        .flatMap((entry) => entry.deliveredSections),
    ),
  ].sort();
}

async function runEditorFlows(
  fixture: LspFixture,
  projectRoot: string,
  pullDiagnosticsAvailable: boolean,
  syncShape: string,
  documentVersions: Map<string, number>,
): Promise<
  Omit<
    FlowCapture,
    | "configurationRequestSections"
    | "configurationDeliveredSections"
    | "renameProviderAdvertised"
  >
> {
  const completionPath = path.join(projectRoot, "models/completion_probe.sql");
  const completionUri = fileUri(completionPath);
  const completionValid = "select * from {{ ref('base') }}\n";
  const completionPartial = "select * from {{ ref('";
  let completionVersion = documentVersions.get(completionUri) ?? 1;

  completionVersion = await applyDocumentChange(
    fixture,
    completionUri,
    completionVersion,
    completionValid,
    completionPartial,
    syncShape,
    documentVersions,
  );
  const completionRaw = await classifiedRequest<{
    items?: { label?: string }[];
  }>(
    fixture,
    "textDocument/completion",
    {
      textDocument: { uri: completionUri },
      position: { line: 0, character: completionPartial.length },
    },
    REQUEST_MS,
    (value) => {
      const items = value.items ?? [];
      return items.length === 0 ? "empty" : "ok";
    },
  );
  const completionLabels =
    completionRaw.value?.items?.map((item) => item.label ?? "") ?? [];
  const completionOutcome: RequestOutcome<{ labels: string[] }> = {
    kind: completionRaw.kind,
    lspErrorCode: completionRaw.lspErrorCode,
    timeoutMethod: completionRaw.timeoutMethod,
    requestFailed: completionRaw.requestFailed,
    value: { labels: completionLabels },
  };

  completionVersion = await applyDocumentChange(
    fixture,
    completionUri,
    completionVersion,
    completionPartial,
    completionValid,
    syncShape,
    documentVersions,
  );
  fixture.notify("textDocument/didSave", {
    textDocument: { uri: completionUri },
  });
  await waitForDocumentAck(fixture, completionUri, "Did save", SYNC_ACK_MS);

  const pkgMacroPath = path.join(projectRoot, "models/pkg_macro_user.sql");
  const pkgMacroUri = fileUri(pkgMacroPath);
  const pkgMacroText = fs.readFileSync(pkgMacroPath, "utf-8");
  const packagePrefix = "editor_flow_pkg.";
  const macroSegmentStart =
    pkgMacroText.indexOf(packagePrefix) + packagePrefix.length;
  const packageQualifierStart = pkgMacroText.indexOf("editor_flow_pkg");

  const hoverPackageRaw = await classifiedRequest(
    fixture,
    "textDocument/hover",
    {
      textDocument: { uri: pkgMacroUri },
      position: { line: 0, character: packageQualifierStart + 2 },
    },
    REQUEST_MS,
    (value) => {
      const contentClass = hoverContentClass(value);
      return contentClass === "none" || contentClass.startsWith("empty")
        ? "empty"
        : "ok";
    },
  );
  const hoverPackageQualifier: RequestOutcome<{ contentClass: string }> = {
    kind: hoverPackageRaw.kind,
    lspErrorCode: hoverPackageRaw.lspErrorCode,
    timeoutMethod: hoverPackageRaw.timeoutMethod,
    requestFailed: hoverPackageRaw.requestFailed,
    value:
      hoverPackageRaw.kind === "ok" || hoverPackageRaw.kind === "empty"
        ? { contentClass: hoverContentClass(hoverPackageRaw.value ?? null) }
        : undefined,
  };

  const hoverMacroRaw = await classifiedRequest(
    fixture,
    "textDocument/hover",
    {
      textDocument: { uri: pkgMacroUri },
      position: { line: 0, character: macroSegmentStart + 2 },
    },
    REQUEST_MS,
    (value) => {
      const contentClass = hoverContentClass(value);
      return contentClass === "none" || contentClass.startsWith("empty")
        ? "empty"
        : "ok";
    },
  );
  const hoverOutcome: RequestOutcome<{ contentClass: string }> = {
    kind: hoverMacroRaw.kind,
    lspErrorCode: hoverMacroRaw.lspErrorCode,
    timeoutMethod: hoverMacroRaw.timeoutMethod,
    requestFailed: hoverMacroRaw.requestFailed,
    value:
      hoverMacroRaw.kind === "ok" || hoverMacroRaw.kind === "empty"
        ? { contentClass: hoverContentClass(hoverMacroRaw.value ?? null) }
        : undefined,
  };

  const childPath = path.join(projectRoot, "models/child.sql");
  const childUri = fileUri(childPath);
  const childText = fs.readFileSync(childPath, "utf-8");
  const refIndex = childText.indexOf("base");
  const definitionRaw = await classifiedRequest(
    fixture,
    "textDocument/definition",
    {
      textDocument: { uri: childUri },
      position: { line: 0, character: refIndex + 1 },
    },
    REQUEST_MS,
    (value) => (definitionUri(value) ? "ok" : "empty"),
  );
  const definitionTarget = definitionUri(definitionRaw.value ?? null);
  const definitionOutcome: RequestOutcome<{ matchesExpected: boolean }> = {
    kind: definitionRaw.kind,
    lspErrorCode: definitionRaw.lspErrorCode,
    timeoutMethod: definitionRaw.timeoutMethod,
    requestFailed: definitionRaw.requestFailed,
    value: {
      matchesExpected:
        definitionTarget !== undefined &&
        relativeUri(projectRoot, definitionTarget) === "models/base.sql",
    },
  };

  const prepareRenameRaw = await classifiedRequest(
    fixture,
    "textDocument/prepareRename",
    {
      textDocument: { uri: childUri },
      position: { line: 0, character: refIndex + 1 },
    },
    REQUEST_MS,
    (value) => (prepareRenameAccepts(value).accepts ? "ok" : "empty"),
  );
  const prepareRenameOutcome: RequestOutcome<{
    accepts: boolean;
    shape: string;
  }> = {
    kind: prepareRenameRaw.kind,
    lspErrorCode: prepareRenameRaw.lspErrorCode,
    timeoutMethod: prepareRenameRaw.timeoutMethod,
    requestFailed: prepareRenameRaw.requestFailed,
    value: prepareRenameAccepts(prepareRenameRaw.value ?? null),
  };

  const renameRaw = await classifiedRequest(
    fixture,
    "textDocument/rename",
    {
      textDocument: { uri: childUri },
      position: { line: 0, character: refIndex + 1 },
      newName: "base_renamed",
    },
    REQUEST_MS,
    (value) => {
      const files = workspaceEditFiles(projectRoot, value);
      return files.editFileCount === 0 ? "empty" : "ok";
    },
  );
  const renameOutcome: RequestOutcome<{
    editFileCount: number;
    relativeFiles: string[];
  }> = {
    kind: renameRaw.kind,
    lspErrorCode: renameRaw.lspErrorCode,
    timeoutMethod: renameRaw.timeoutMethod,
    requestFailed: renameRaw.requestFailed,
    value: workspaceEditFiles(projectRoot, renameRaw.value ?? null),
  };

  const formatUri = fileUri(path.join(projectRoot, "models/format_me.sql"));
  const formattingRaw = await classifiedRequest(
    fixture,
    "textDocument/formatting",
    {
      textDocument: { uri: formatUri },
      options: { tabSize: 2, insertSpaces: true },
    },
    REQUEST_MS,
    (value) => (formattingEditCount(value) === 0 ? "empty" : "ok"),
  );
  const formattingOutcome: RequestOutcome<{ editCount: number }> = {
    kind: formattingRaw.kind,
    lspErrorCode: formattingRaw.lspErrorCode,
    timeoutMethod: formattingRaw.timeoutMethod,
    requestFailed: formattingRaw.requestFailed,
    value: {
      editCount: formattingEditCount(formattingRaw.value ?? null),
    },
  };

  const flowProgressCursor = fixture.notificationCount("$/progress");
  const diagFlowCursor = fixture.notificationCount(
    "textDocument/publishDiagnostics",
  );

  const childVersion = documentVersions.get(childUri) ?? 1;
  const brokenRefText = "select * from {{ ref('missing_model') }}\n";
  await applyDocumentChange(
    fixture,
    childUri,
    childVersion,
    childText,
    brokenRefText,
    syncShape,
    documentVersions,
  );
  const childRelative = "models/child.sql";
  try {
    await fixture.waitForNotification(
      "textDocument/publishDiagnostics",
      (params) => {
        if (typeof params !== "object" || params === null) {
          return false;
        }
        const uri = (params as { uri?: string }).uri ?? "";
        if (relativeUri(projectRoot, uri) !== childRelative) {
          return false;
        }
        const diags = (params as { diagnostics?: unknown[] }).diagnostics;
        return Array.isArray(diags) && diags.length > 0;
      },
      REQUEST_MS,
      diagFlowCursor,
    );
  } catch {
    // Outcome recorded from captured notifications below.
  }

  const diagnosticPath = path.join(projectRoot, "models/diagnostic_model.sql");
  const diagnosticUri = fileUri(diagnosticPath);
  const diagnosticRelative = "models/diagnostic_model.sql";
  const diagnosticText = fs.readFileSync(diagnosticPath, "utf-8");
  const diagnosticVersion = documentVersions.get(diagnosticUri) ?? 1;
  const brokenDiagnosticText = "select from\n";
  await applyDocumentChange(
    fixture,
    diagnosticUri,
    diagnosticVersion,
    diagnosticText,
    brokenDiagnosticText,
    syncShape,
    documentVersions,
  );

  const brokenRefPushEntries = fixture
    .getNotifications("textDocument/publishDiagnostics")
    .flatMap((params) => parseDiagnostics(params));
  const brokenRefSinceEntries = fixture
    .getNotificationsSince("textDocument/publishDiagnostics", diagFlowCursor)
    .flatMap((params) => parseDiagnostics(params));
  const brokenRefAbsoluteSummaries = summarizeDiagnostics(
    projectRoot,
    brokenRefPushEntries,
  );
  const brokenRefSummaries = brokenRefSinceEntries
    .filter((entry) => relativeUri(projectRoot, entry.uri) === childRelative)
    .map((entry) => ({
      relativeUri: childRelative,
      severity: entry.severity,
      codeClass: entry.codeClass,
    }));

  let pullOutcome: RequestOutcome<{ count: number }> = {
    kind: "null",
    value: { count: 0 },
  };
  if (pullDiagnosticsAvailable) {
    const pullRaw = await classifiedRequest<{ items?: unknown[] }>(
      fixture,
      "textDocument/diagnostic",
      { textDocument: { uri: childUri } },
      REQUEST_MS,
      (value) => {
        const items = value.items ?? [];
        return items.length === 0 ? "empty" : "ok";
      },
    );
    pullOutcome = {
      kind: pullRaw.kind,
      lspErrorCode: pullRaw.lspErrorCode,
      timeoutMethod: pullRaw.timeoutMethod,
      requestFailed: pullRaw.requestFailed,
      value: { count: pullRaw.value?.items?.length ?? 0 },
    };
  }

  const diagnosticAbsoluteEntries = brokenRefPushEntries.filter(
    (entry) => relativeUri(projectRoot, entry.uri) === diagnosticRelative,
  );
  const lintDiagnostics = diagnosticAbsoluteEntries.map((entry) => entry.full);
  const codeActionRaw = await classifiedRequest(
    fixture,
    "textDocument/codeAction",
    {
      textDocument: { uri: diagnosticUri },
      range: {
        start: { line: 0, character: 0 },
        end: endPosition(brokenDiagnosticText),
      },
      context: {
        diagnostics: lintDiagnostics,
        only: ["source.fixAll.dbtLintFix"],
      },
    },
    REQUEST_MS,
    (value) => (Array.isArray(value) && value.length > 0 ? "ok" : "empty"),
  );
  const lintFix = codeActionLintFix(codeActionRaw.value ?? null);
  const lintDiagnosticsPassed = lintDiagnostics.length;
  const codeActionOutcome: RequestOutcome<{
    offered: boolean;
    actionShape: string;
    diagnosticsPassed: number;
    diagnosticRelativeUri: string;
    exercised: boolean;
  }> = {
    kind: lintDiagnosticsPassed === 0 ? "null" : codeActionRaw.kind,
    lspErrorCode: codeActionRaw.lspErrorCode,
    timeoutMethod: codeActionRaw.timeoutMethod,
    requestFailed: codeActionRaw.requestFailed,
    value: {
      ...lintFix,
      diagnosticsPassed: lintDiagnosticsPassed,
      diagnosticRelativeUri: diagnosticRelative,
      exercised: lintDiagnosticsPassed > 0,
    },
  };

  const projectInfoRaw = await classifiedRequest(
    fixture,
    "workspace/executeCommand",
    {
      command: prefixedCommand("dbt.getProjectInfo"),
      arguments: [],
    },
    REQUEST_MS,
    (value) => {
      if (value === null) {
        return "null";
      }
      if (
        typeof value === "object" &&
        Object.keys(value as object).length === 0
      ) {
        return "empty";
      }
      return "ok";
    },
  );
  const projectInfoOutcome: RequestOutcome<{ shape: string }> = {
    kind: projectInfoRaw.kind,
    lspErrorCode: projectInfoRaw.lspErrorCode,
    timeoutMethod: projectInfoRaw.timeoutMethod,
    requestFailed: projectInfoRaw.requestFailed,
    value: {
      shape:
        projectInfoRaw.value === null || projectInfoRaw.value === undefined
          ? "null"
          : typeof projectInfoRaw.value === "object" &&
              Object.keys(projectInfoRaw.value as object).length === 0
            ? "empty-object"
            : "object",
    },
  };

  const flowProgress = collectProgress(fixture, flowProgressCursor);

  return {
    completion: completionOutcome,
    hoverPackageQualifier,
    hoverPackageMacro: hoverOutcome,
    definition: definitionOutcome,
    prepareRename: prepareRenameOutcome,
    rename: renameOutcome,
    formatting: formattingOutcome,
    brokenRefPush: {
      absoluteTotal: brokenRefPushEntries.length,
      absoluteSummaries: brokenRefAbsoluteSummaries,
      sinceCursorCount: brokenRefSinceEntries.length,
      summaries: brokenRefSummaries,
    },
    brokenRefPull: pullOutcome,
    lintCodeAction: codeActionOutcome,
    getProjectInfo: projectInfoOutcome,
    flowProgress,
    pullDiagnosticsAvailable,
    textDocumentSyncShape: syncShape,
    protocolErrors: fixture.getErrors().length,
  };
}

function workspaceEditFiles(
  projectRoot: string,
  result: unknown,
): { editFileCount: number; relativeFiles: string[] } {
  if (typeof result !== "object" || result === null) {
    return { editFileCount: 0, relativeFiles: [] };
  }
  const changes =
    (result as { changes?: Record<string, unknown[]> }).changes ?? {};
  const documentChanges =
    (result as { documentChanges?: unknown[] }).documentChanges ?? [];
  const relativeFiles = new Set<string>();
  for (const uri of Object.keys(changes)) {
    relativeFiles.add(relativeUri(projectRoot, uri));
  }
  for (const change of documentChanges) {
    if (typeof change !== "object" || change === null) {
      continue;
    }
    const textDocument = (change as { textDocument?: { uri?: string } })
      .textDocument;
    if (textDocument?.uri) {
      relativeFiles.add(relativeUri(projectRoot, textDocument.uri));
    }
  }
  return {
    editFileCount: relativeFiles.size,
    relativeFiles: [...relativeFiles].sort(),
  };
}

async function openProjectDocuments(
  fixture: LspFixture,
  projectRoot: string,
): Promise<Map<string, number>> {
  const files = [
    "dbt_project.yml",
    "packages.yml",
    "models/base.sql",
    "models/child.sql",
    "models/completion_probe.sql",
    "models/diagnostic_model.sql",
    "models/lintable.sql",
    "models/format_me.sql",
    "models/pkg_macro_user.sql",
    "models/schema.yml",
    "macros/example.sql",
  ];
  const versions = new Map<string, number>();
  for (const [index, relativePath] of files.entries()) {
    const absolutePath = path.join(projectRoot, relativePath);
    const text = fs.readFileSync(absolutePath, "utf-8");
    const uri = fileUri(absolutePath);
    const version = index + 1;
    versions.set(uri, version);
    fixture.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId: relativePath.endsWith(".yml") ? "yaml" : "jinja-sql",
        version,
        text,
      },
    });
    await waitForDocumentAck(fixture, uri, "Did open", SYNC_ACK_MS);
  }
  return versions;
}

async function runArm(arm: ArmId, sourceRoot: string): Promise<ArmCapture> {
  // Matches Fusion Power User's buildWorkspaceConfigurationResponse (docs/refactor/
  // official-client-contracts.md): only {lsp:{linter:{enabled}}} for section "dbt".
  const configurationBySection: Record<string, unknown> = {
    dbt: { lsp: { linter: { enabled: true } } },
  };
  const fixture = await createLspFixture(sourceRoot, sourceRoot, {
    prepareProject: prepareEditorFlowProject,
    extraArgs: [
      "--command-prefix",
      COMMAND_PREFIX,
      "--lint-enabled",
      "true",
      "--static-analysis",
      "baseline",
      "--profile",
      "single_project",
      "--target",
      "test",
    ],
    // cwd = project root and DBT_LSP_USE_TARGET_LSP=1 match the official client's
    // spawn contract (docs/refactor/official-client-contracts.md).
    env: { DBT_LSP_USE_TARGET_LSP: "1" },
    useProjectRootAsCwd: true,
    configurationBySection,
    defaultRequestTimeoutMs: REQUEST_MS,
  });

  try {
    const preflight = runPreflight(fixture.projectRoot);
    await fixture.connect(30_000);

    const configCursor = fixture.serverRequestCount("workspace/configuration");
    const configDeliveryCursor = fixture.configurationDeliveryCount();

    const init = await fixture.request<{
      capabilities: Record<string, unknown>;
    }>(
      "initialize",
      {
        processId: process.pid,
        rootUri: fileUri(fixture.projectRoot),
        workspaceFolders: [
          {
            uri: fileUri(fixture.projectRoot),
            name: path.basename(fixture.projectRoot),
          },
        ],
        capabilities: initializeCapabilities(),
      },
      REQUEST_MS,
    );
    const capabilities = init.capabilities ?? {};
    const pullDiagnosticsAvailable =
      capabilities.diagnosticProvider !== undefined;
    const syncShape = textDocumentSyncShape(capabilities);
    const renameProviderAdvertised = capabilities.renameProvider !== undefined;

    fixture.notify("initialized", {});
    const documentVersions = await openProjectDocuments(
      fixture,
      fixture.projectRoot,
    );
    const afterOpenSnapshots = snapshotTargetPaths(fixture.projectRoot);

    const triggerCursor = fixture.notificationCount("$/progress");
    let beforeCompileSnapshots: TargetFileSnapshot[] | null = null;
    let afterCompileSnapshots: TargetFileSnapshot[] | null = null;

    if (arm === "B" || arm === "C") {
      await classifiedRequest(
        fixture,
        "workspace/executeCommand",
        {
          command: prefixedCommand("dbt.listNodes"),
          arguments: [],
        },
        REQUEST_MS,
        () => "ok",
      );
    }
    if (arm === "C") {
      beforeCompileSnapshots = snapshotTargetPaths(fixture.projectRoot);
      await classifiedRequest(
        fixture,
        "workspace/executeCommand",
        {
          command: prefixedCommand("dbt.compileLsp"),
          arguments: [],
        },
        REQUEST_MS,
        () => "ok",
      );
      await new Promise((resolve) => setTimeout(resolve, TARGET_SETTLE_MS));
      afterCompileSnapshots = snapshotTargetPaths(fixture.projectRoot);
    }

    const triggerProgress = collectProgress(fixture, triggerCursor);
    const flowBody = await runEditorFlows(
      fixture,
      fixture.projectRoot,
      pullDiagnosticsAvailable,
      syncShape,
      documentVersions,
    );
    const configurationRequestSections = extractConfigurationSections(
      fixture,
      configCursor,
    );
    const configurationDeliveredSections =
      extractDeliveredConfigurationSections(fixture, configDeliveryCursor);
    const flows: FlowCapture = {
      ...flowBody,
      renameProviderAdvertised,
      configurationRequestSections,
      configurationDeliveredSections,
    };

    return {
      arm,
      preflight,
      triggerProgress,
      targetSnapshots: {
        afterOpen: afterOpenSnapshots,
        beforeCompileLsp: beforeCompileSnapshots,
        afterCompileLsp: afterCompileSnapshots,
      },
      flows,
    };
  } finally {
    await fixture.close();
  }
}

interface FlowSignature {
  completionKind: OutcomeKind;
  completionHasExpectedLabel: boolean;
  hoverKind: OutcomeKind;
  hoverHasContent: boolean;
  definitionKind: OutcomeKind;
  definitionMatches: boolean;
  prepareRenameKind: OutcomeKind;
  prepareRenameAccepts: boolean;
  renameKind: OutcomeKind;
  renameHasEdits: boolean;
  formattingKind: OutcomeKind;
  formattingHasEdits: boolean;
  brokenRefPushOnChild: boolean;
  brokenRefPullKind: OutcomeKind;
  lintCodeActionExercised: boolean;
  lintCodeActionOffered: boolean;
  getProjectInfoKind: OutcomeKind;
  renameProviderAdvertised: boolean;
}

function flowSignature(capture: ArmCapture): FlowSignature {
  const labels = capture.flows.completion.value?.labels ?? [];
  return {
    completionKind: capture.flows.completion.kind,
    completionHasExpectedLabel: labels.includes("base"),
    hoverKind: capture.flows.hoverPackageMacro.kind,
    hoverHasContent:
      capture.flows.hoverPackageMacro.value?.contentClass !== undefined &&
      !capture.flows.hoverPackageMacro.value.contentClass.startsWith("empty") &&
      capture.flows.hoverPackageMacro.value.contentClass !== "none",
    definitionKind: capture.flows.definition.kind,
    definitionMatches: capture.flows.definition.value?.matchesExpected === true,
    prepareRenameKind: capture.flows.prepareRename.kind,
    prepareRenameAccepts: capture.flows.prepareRename.value?.accepts === true,
    renameKind: capture.flows.rename.kind,
    renameHasEdits: (capture.flows.rename.value?.editFileCount ?? 0) > 0,
    formattingKind: capture.flows.formatting.kind,
    formattingHasEdits: (capture.flows.formatting.value?.editCount ?? 0) > 0,
    brokenRefPushOnChild: capture.flows.brokenRefPush.summaries.length > 0,
    brokenRefPullKind: capture.flows.brokenRefPull.kind,
    lintCodeActionExercised:
      capture.flows.lintCodeAction.value?.exercised === true,
    lintCodeActionOffered: capture.flows.lintCodeAction.value?.offered === true,
    getProjectInfoKind: capture.flows.getProjectInfo.kind,
    renameProviderAdvertised: capture.flows.renameProviderAdvertised,
  };
}

function redactedSummary(captures: ArmCapture[]): string {
  return JSON.stringify({
    fusion: "2.0.5",
    commandPrefix: COMMAND_PREFIX,
    staticAnalysis: "baseline",
    lintEnabled: true,
    arms: captures.map((capture) => ({
      arm: capture.arm,
      preflight: capture.preflight,
      triggerProgress: capture.triggerProgress.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        message: entry.message ? "present" : "",
      })),
      targetWriteEvidence:
        capture.targetSnapshots.beforeCompileLsp &&
        capture.targetSnapshots.afterCompileLsp
          ? targetWriteEvidence(
              capture.targetSnapshots.beforeCompileLsp,
              capture.targetSnapshots.afterCompileLsp,
            )
          : null,
      flows: {
        completion: {
          kind: capture.flows.completion.kind,
          labels: capture.flows.completion.value?.labels ?? [],
        },
        hoverPackageQualifier: {
          kind: capture.flows.hoverPackageQualifier.kind,
          contentClass: capture.flows.hoverPackageQualifier.value?.contentClass,
        },
        hoverPackageMacro: {
          kind: capture.flows.hoverPackageMacro.kind,
          contentClass: capture.flows.hoverPackageMacro.value?.contentClass,
        },
        definition: {
          kind: capture.flows.definition.kind,
          matchesExpected: capture.flows.definition.value?.matchesExpected,
        },
        prepareRename: {
          kind: capture.flows.prepareRename.kind,
          shape: capture.flows.prepareRename.value?.shape,
          lspErrorCode: capture.flows.prepareRename.lspErrorCode,
          methodNotFound: capture.flows.prepareRename.lspErrorCode === -32601,
        },
        rename: {
          kind: capture.flows.rename.kind,
          editFileCount: capture.flows.rename.value?.editFileCount ?? 0,
          relativeFiles: capture.flows.rename.value?.relativeFiles ?? [],
          timeoutMethod: capture.flows.rename.timeoutMethod,
          advertisedEmpty:
            capture.flows.rename.kind === "null" ||
            (capture.flows.rename.kind === "empty" &&
              (capture.flows.rename.value?.editFileCount ?? 0) === 0),
        },
        formatting: {
          kind: capture.flows.formatting.kind,
          editCount: capture.flows.formatting.value?.editCount ?? 0,
        },
        brokenRefPush: capture.flows.brokenRefPush,
        brokenRefPull: capture.flows.brokenRefPull,
        lintCodeAction: capture.flows.lintCodeAction,
        getProjectInfo: capture.flows.getProjectInfo,
        flowProgress: capture.flows.flowProgress.map((entry) => ({
          kind: entry.kind,
          title: entry.title,
          message: entry.message ? "present" : "",
        })),
        configurationRequestSections:
          capture.flows.configurationRequestSections,
        configurationDeliveredSections:
          capture.flows.configurationDeliveredSections,
        pullDiagnosticsAvailable: capture.flows.pullDiagnosticsAvailable,
        textDocumentSyncShape: capture.flows.textDocumentSyncShape,
        renameProviderAdvertised: capture.flows.renameProviderAdvertised,
        protocolErrors: capture.flows.protocolErrors,
      },
    })),
  });
}

function fusionSkipReason(
  verdict: ReturnType<typeof checkFusionVersion>,
): string {
  switch (verdict.kind) {
    case "notFusion":
      return "dbt Fusion was not found on PATH";
    case "tooOld":
      return "dbt Fusion on PATH is older than 2.0.5";
    case "untestedMajor":
      return "dbt Fusion major version is untested";
    default:
      return "dbt Fusion on PATH is not supported for this capture";
  }
}

suite("Fusion editor flow capture", function () {
  this.timeout(SUITE_TIMEOUT_MS);

  const fusionVerdict = checkFusionVersion();
  const sourceRoot = fixturePath("single-project");

  suiteSetup(function () {
    if (!CAPTURE_ENABLED) {
      console.warn(
        "Skipping Fusion editor flow capture: set FPU_RUN_EDITOR_FLOW_CAPTURE=1 to run.",
      );
      this.skip();
    }
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        `Skipping Fusion editor flow capture: ${fusionSkipReason(fusionVerdict)}.`,
      );
      this.skip();
    }
  });

  test("captures native editor flows without clearTarget", async function () {
    this.timeout(SUITE_TIMEOUT_MS);
    const passes: ArmCapture[][] = [[], []];
    for (const passIndex of [0, 1]) {
      for (const arm of ["A", "B", "C"] as const) {
        const armStarted = Date.now();
        passes[passIndex].push(await runArm(arm, sourceRoot));
        const armElapsed = Date.now() - armStarted;
        assert.ok(
          armElapsed <= PER_ARM_BUDGET_MS,
          `arm ${arm} pass ${passIndex} exceeded ${PER_ARM_BUDGET_MS}ms (${armElapsed}ms)`,
        );
      }
    }

    for (const capture of passes[0]) {
      assert.strictEqual(
        capture.preflight.depsExit,
        0,
        `arm ${capture.arm} dbt deps must exit 0`,
      );
      assert.strictEqual(
        capture.preflight.parseExit,
        0,
        `arm ${capture.arm} dbt parse must exit 0`,
      );
    }

    for (const arm of ["A", "B", "C"] as const) {
      const first = passes[0].find((capture) => capture.arm === arm);
      const second = passes[1].find((capture) => capture.arm === arm);
      assert.ok(first && second, `missing pass for arm ${arm}`);
      assert.deepStrictEqual(
        flowSignature(first),
        flowSignature(second),
        `arm ${arm} outcome classes must be reproducible`,
      );
    }

    console.log(`FPU_EDITOR_FLOW_CAPTURE=${redactedSummary(passes[0])}`);
  });
});
