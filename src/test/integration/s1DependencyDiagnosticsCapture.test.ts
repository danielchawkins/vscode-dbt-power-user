import * as assert from "assert";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { checkFusionVersion, fixturePath } from "./helpers/testFixtures";
import { createLspFixture, LspFixture } from "./lspFixture";
import type {
  NotificationEntry,
  ServerRequestEntry,
} from "./lspProtocolClient";
import { LspRequestError } from "./lspProtocolClient";

const EXPECTED_ARM_COUNT = 6;
const OBSERVATION_MS = 90_000;
const MIN_OBSERVATION_MS = 5_000;
const PROBE_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;

const LSP_EXTRA_ARGS = [
  "--lint-enabled",
  "true",
  "--static-analysis",
  "baseline",
];

const INCOMPLETE_REF_TEXT = "select * from {{ ref('";
const EXPECTED_COMPLETION_TARGET = "base";

type ArmId =
  | "control"
  | "rootMetadataError"
  | "dependencyModelError"
  | "brokenDependencyManifest";

type ProbeOutcome = "success" | "null" | "empty" | "error" | "timeout";
type DiagnosticScope = "root" | "dependency" | "unknown";

interface ProbeResult {
  outcome: ProbeOutcome;
  errorCode: number | null;
  detail: string | null;
}

interface ControlLoadProbes {
  getProjectInfo: ProbeResult;
  completion: ProbeResult;
  definition: ProbeResult;
}

interface RedactedDiagnostic {
  scope: DiagnosticScope;
  relativePath: string | null;
  severity: number | null;
  codeClass: string | null;
  messageClass: string | null;
  source: string | null;
}

interface ProgressSummary {
  beginCount: number;
  endCount: number;
  titles: string[];
  tokenSuffixes: string[];
}

interface PathDescriptor {
  lexical: string;
  canonical: string;
  scope: "root" | "dependency-installed" | "dependency-source";
}

interface ArmCapture {
  arm: ArmId;
  runIndex: number;
  preflight: {
    depsExitCode: number | null;
    parseExitCode: number | null;
    parseErrorClass: string | null;
  };
  pathLayout: {
    project: PathDescriptor;
    packageSource: PathDescriptor | null;
    packageInstalled: PathDescriptor | null;
  };
  openedFiles: readonly string[];
  serverArgv: readonly string[];
  initializeCapabilityKeys: string[];
  diagnosticProviderAdvertised: boolean;
  serverRegistrations: Array<{ id: string; method: string; globs: string[] }>;
  serverRequestMethods: readonly string[];
  progressPostListNodes: ProgressSummary;
  publishDiagnostics: RedactedDiagnostic[];
  pullDiagnostic: ProbeResult;
  pullDiagnosticPathClass: PathDescriptor["scope"] | "root";
  loadProbes: ControlLoadProbes | "not-probed";
  harnessErrorClasses: string[];
  stderrLineCount: number;
  timingsMs: {
    connect: number;
    initialize: number;
    observation: number;
  };
}

interface D3Verdict {
  status: "provisional" | "decided";
  policy?: "confinement" | "filter";
  fusionRootBlocker?: boolean;
  syntheticBlocker?: boolean;
  reason?: string;
}

interface S1CaptureSummary {
  fusionVersion: string;
  capturedAt: string;
  controlLoaded: boolean;
  verdict: D3Verdict;
  arms: ArmCapture[];
}

function s1CaptureEnabled(): boolean {
  return process.env.FPU_RUN_S1_CAPTURE === "1";
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

function fusionVersionLabel(
  verdict: ReturnType<typeof checkFusionVersion>,
): string {
  if (verdict.kind === "ok") {
    const version = verdict.version;
    return `${version.major}.${version.minor}.${version.patch}`;
  }
  return verdict.kind;
}

function fileUri(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

function languageId(relativePath: string): string {
  if (relativePath.endsWith(".yml") || relativePath.endsWith(".yaml")) {
    return "yaml";
  }
  return "jinja-sql";
}

function pkgSourceRoot(projectRoot: string, pkgName: string): string {
  return path.join(path.dirname(projectRoot), "pkg-source", pkgName);
}

function redactAbsolute(value: string, projectRoot: string): string {
  const resolvedProject = path.resolve(projectRoot);
  const pkgSourceParent = path.join(
    path.dirname(resolvedProject),
    "pkg-source",
  );
  let result = value;
  for (const candidate of [resolvedProject, `/private${resolvedProject}`]) {
    result = result.split(candidate).join("<project>");
  }
  for (const candidate of [pkgSourceParent, `/private${pkgSourceParent}`]) {
    result = result.split(candidate).join("<pkg-source>");
  }
  return result
    .replace("/private<project>", "<project>")
    .replace("/private<pkg-source>", "<pkg-source>");
}

function pathDescriptor(
  absolutePath: string,
  projectRoot: string,
  scope: PathDescriptor["scope"],
): PathDescriptor {
  const lexical = redactAbsolute(absolutePath, projectRoot);
  let canonical = lexical;
  try {
    canonical = redactAbsolute(fs.realpathSync(absolutePath), projectRoot);
  } catch {
    // Keep lexical when the path does not exist yet.
  }
  return { lexical, canonical, scope };
}

function classifyMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("dependency not found") ||
    normalized.includes("dbt1048")
  ) {
    return "dependency-not-found";
  }
  if (
    normalized.includes("serializationerror") ||
    normalized.includes("yaml error")
  ) {
    return "yaml-serialization";
  }
  if (
    normalized.includes("syntax error") ||
    normalized.includes("parse error")
  ) {
    return "syntax-error";
  }
  if (normalized.includes("lint") || normalized.includes("sqlfluff")) {
    return "lint";
  }
  if (normalized.includes("ref(")) {
    return "ref-resolution";
  }
  if (normalized.includes("timed out")) {
    return "timeout";
  }
  if (normalized.includes("method not found")) {
    return "method-not-found";
  }
  return "other";
}

function classifyCode(code: unknown): string | null {
  if (code === undefined || code === null) {
    return null;
  }
  if (typeof code === "string") {
    return classifyMessage(code);
  }
  if (typeof code === "object" && code !== null && "value" in code) {
    return classifyCode((code as { value?: unknown }).value);
  }
  return "other";
}

function diagnosticScopeForUri(
  uri: string,
  projectRoot: string,
): { scope: DiagnosticScope; relativePath: string | null } {
  const redacted = redactAbsolute(uri, projectRoot);
  const projectMarker = "<project>/";
  const idx = redacted.indexOf(projectMarker);
  const relativePath =
    idx >= 0 ? redacted.slice(idx + projectMarker.length) : null;
  if (redacted.includes("dbt_packages/")) {
    return { scope: "dependency", relativePath };
  }
  if (redacted.includes("<pkg-source>/")) {
    return { scope: "dependency", relativePath };
  }
  if (relativePath !== null) {
    return { scope: "root", relativePath };
  }
  return { scope: "unknown", relativePath: null };
}

function redactDiagnostics(
  params: unknown,
  projectRoot: string,
): RedactedDiagnostic[] {
  if (typeof params !== "object" || params === null) {
    return [];
  }
  const uri = String((params as { uri?: string }).uri ?? "");
  const { scope, relativePath } = diagnosticScopeForUri(uri, projectRoot);
  const diagnostics = (params as { diagnostics?: unknown[] }).diagnostics;
  if (!Array.isArray(diagnostics)) {
    return [];
  }
  return diagnostics.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return {
        scope,
        relativePath,
        severity: null,
        codeClass: null,
        messageClass: "other",
        source: null,
      };
    }
    const diagnostic = entry as {
      severity?: number;
      code?: unknown;
      message?: string;
      source?: string;
    };
    return {
      scope,
      relativePath,
      severity: diagnostic.severity ?? null,
      codeClass: classifyCode(diagnostic.code),
      messageClass: classifyMessage(diagnostic.message ?? ""),
      source: diagnostic.source ?? null,
    };
  });
}

function summarizeProgress(
  entries: readonly NotificationEntry[],
): ProgressSummary {
  const titles = new Set<string>();
  const tokenSuffixes = new Set<string>();
  let beginCount = 0;
  let endCount = 0;

  for (const entry of entries) {
    if (typeof entry.params !== "object" || entry.params === null) {
      continue;
    }
    const value = (entry.params as { value?: unknown; token?: string }).value;
    const token = (entry.params as { token?: string }).token;
    if (typeof token === "string" && token.includes("/")) {
      tokenSuffixes.add(token.slice(token.lastIndexOf("/") + 1));
    }
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const kind = (value as { kind?: string }).kind;
    const title = (value as { title?: string }).title;
    if (kind === "begin") {
      beginCount += 1;
    }
    if (kind === "end") {
      endCount += 1;
    }
    if (title) {
      titles.add(title);
    }
  }

  return {
    beginCount,
    endCount,
    titles: [...titles],
    tokenSuffixes: [...tokenSuffixes],
  };
}

function summarizeRegistrations(
  requests: readonly ServerRequestEntry[],
): Array<{ id: string; method: string; globs: string[] }> {
  const registrations: Array<{ id: string; method: string; globs: string[] }> =
    [];
  for (const entry of requests) {
    if (entry.method !== "client/registerCapability") {
      continue;
    }
    if (typeof entry.params !== "object" || entry.params === null) {
      continue;
    }
    const regParams = entry.params as {
      registrations?: Array<{
        id?: string;
        method?: string;
        registerOptions?: {
          globPattern?: string;
          watchers?: Array<{ globPattern?: string }>;
        };
      }>;
    };
    for (const registration of regParams.registrations ?? []) {
      const globs: string[] = [];
      const options = registration.registerOptions;
      if (options?.globPattern) {
        globs.push(options.globPattern);
      }
      for (const watcher of options?.watchers ?? []) {
        if (watcher.globPattern) {
          globs.push(watcher.globPattern);
        }
      }
      registrations.push({
        id: registration.id ?? "unknown",
        method: registration.method ?? "unknown",
        globs,
      });
    }
  }
  return registrations;
}

function parseErrorClass(stderr: string): string | null {
  const match = stderr.match(/\[([A-Za-z]+)\s*\(([^)]+)\)\]/);
  if (!match) {
    return null;
  }
  return `${match[1]} (${match[2]})`;
}

function runDbtCommand(
  command: "deps" | "parse",
  projectRoot: string,
): { exitCode: number; errorClass: string | null } {
  const result = spawnSync(
    "dbt",
    [
      command,
      "--project-dir",
      projectRoot,
      "--profiles-dir",
      projectRoot,
      "--no-version-check",
    ],
    { encoding: "utf-8", timeout: 120_000 },
  );
  return {
    exitCode: result.status ?? 1,
    errorClass:
      result.status === 0 ? null : parseErrorClass(result.stderr ?? ""),
  };
}

function prepareCleanBase(projectRoot: string): void {
  for (const relativePath of ["models/child.sql", "models/broken_ref.sql"]) {
    fs.rmSync(path.join(projectRoot, relativePath), { force: true });
  }
  fs.writeFileSync(
    path.join(projectRoot, "models/base.sql"),
    "select 1 as id\n",
  );
  fs.writeFileSync(
    path.join(projectRoot, "models/child_model.sql"),
    "select * from {{ ref('base') }}\n",
  );
}

function writeExternalPackage(
  projectRoot: string,
  pkgName: string,
  writePackage: (pkgRoot: string) => void,
): string {
  const sourceRoot = pkgSourceRoot(projectRoot, pkgName);
  fs.mkdirSync(path.join(sourceRoot, "models"), { recursive: true });
  writePackage(sourceRoot);
  fs.writeFileSync(
    path.join(projectRoot, "packages.yml"),
    `packages:\n  - local: ../pkg-source/${pkgName}\n`,
  );
  return sourceRoot;
}

function prepareControl(projectRoot: string): void {
  prepareCleanBase(projectRoot);
  writeExternalPackage(projectRoot, "clean_pkg", (pkgRoot) => {
    fs.writeFileSync(
      path.join(pkgRoot, "dbt_project.yml"),
      "name: clean_pkg\nversion: 1.0.0\nconfig-version: 2\n",
    );
    fs.writeFileSync(
      path.join(pkgRoot, "models/pkg_model.sql"),
      "select 3 as pkg_value\n",
    );
  });
}

function prepareRootMetadataError(projectRoot: string): void {
  prepareControl(projectRoot);
  fs.writeFileSync(
    path.join(projectRoot, "dbt_project.yml"),
    "name: [invalid\n",
  );
}

function prepareDependencyModelError(projectRoot: string): void {
  prepareCleanBase(projectRoot);
  writeExternalPackage(projectRoot, "err_pkg", (pkgRoot) => {
    fs.writeFileSync(
      path.join(pkgRoot, "dbt_project.yml"),
      "name: err_pkg\nversion: 1.0.0\nconfig-version: 2\n",
    );
    fs.writeFileSync(
      path.join(pkgRoot, "models/bad_pkg.sql"),
      'select * from {{ ref("missing") }}\n',
    );
  });
}

function prepareBrokenDependencyManifest(projectRoot: string): void {
  prepareCleanBase(projectRoot);
  writeExternalPackage(projectRoot, "broken_pkg", (pkgRoot) => {
    fs.writeFileSync(path.join(pkgRoot, "dbt_project.yml"), "name: [invalid\n");
    fs.writeFileSync(path.join(pkgRoot, "models/pkg.sql"), "select 1 as id\n");
  });
}

function armPrepare(arm: ArmId): (projectRoot: string) => void {
  switch (arm) {
    case "control":
      return prepareControl;
    case "rootMetadataError":
      return prepareRootMetadataError;
    case "dependencyModelError":
      return prepareDependencyModelError;
    case "brokenDependencyManifest":
      return prepareBrokenDependencyManifest;
  }
}

function packageNameForArm(arm: ArmId): string | null {
  switch (arm) {
    case "control":
      return "clean_pkg";
    case "dependencyModelError":
      return "err_pkg";
    case "brokenDependencyManifest":
      return "broken_pkg";
    default:
      return null;
  }
}

function armOpenFiles(arm: ArmId): string[] {
  const common = [
    "dbt_project.yml",
    "packages.yml",
    "models/base.sql",
    "models/child_model.sql",
  ];
  switch (arm) {
    case "control":
      return [...common, "dbt_packages/clean_pkg/models/pkg_model.sql"];
    case "rootMetadataError":
      return common;
    case "dependencyModelError":
      return [...common, "dbt_packages/err_pkg/models/bad_pkg.sql"];
    case "brokenDependencyManifest":
      return common;
  }
}

interface PullDiagnosticTarget {
  absolutePath: string;
  pathClass: PathDescriptor["scope"] | "root";
}

function pullDiagnosticTarget(
  arm: ArmId,
  projectRoot: string,
  packageSourcePath: string | null,
): PullDiagnosticTarget {
  switch (arm) {
    case "rootMetadataError":
      return {
        absolutePath: path.join(projectRoot, "dbt_project.yml"),
        pathClass: "root",
      };
    case "dependencyModelError":
      return {
        absolutePath: path.join(
          projectRoot,
          "dbt_packages/err_pkg/models/bad_pkg.sql",
        ),
        pathClass: "dependency-installed",
      };
    case "brokenDependencyManifest":
      assert.ok(
        packageSourcePath,
        "broken manifest arm requires external package source",
      );
      return {
        absolutePath: path.join(packageSourcePath, "dbt_project.yml"),
        pathClass: "dependency-source",
      };
    default:
      return {
        absolutePath: path.join(projectRoot, "models/child_model.sql"),
        pathClass: "root",
      };
  }
}

function projectRootUri(projectRoot: string): string {
  return pathToFileURL(path.resolve(projectRoot)).href;
}

function buildInitializeParams(projectRoot: string): Record<string, unknown> {
  const rootUri = projectRootUri(projectRoot);
  return {
    processId: process.pid,
    rootUri,
    workspaceFolders: [
      {
        uri: rootUri,
        name: path.basename(projectRoot),
      },
    ],
    capabilities: {
      window: { workDoneProgress: true },
      workspace: {
        configuration: true,
        didChangeWatchedFiles: { dynamicRegistration: true },
      },
      textDocument: {
        synchronization: {
          dynamicRegistration: true,
          willSave: true,
          didSave: true,
        },
        publishDiagnostics: {},
        completion: { dynamicRegistration: true },
        hover: { dynamicRegistration: true },
        signatureHelp: { dynamicRegistration: true },
        definition: { dynamicRegistration: true },
        references: { dynamicRegistration: true },
        documentHighlight: { dynamicRegistration: true },
        documentSymbol: { dynamicRegistration: true },
        formatting: { dynamicRegistration: true },
        rangeFormatting: { dynamicRegistration: true },
        rename: { dynamicRegistration: true },
        codeAction: { dynamicRegistration: true },
        codeLens: { dynamicRegistration: true },
        inlayHint: { dynamicRegistration: true },
      },
    },
  };
}

function redactLaunchArgs(
  args: readonly string[],
  projectRoot: string,
): string[] {
  const resolvedProject = path.resolve(projectRoot);
  return args.map((token) => (token === resolvedProject ? "<project>" : token));
}

function openDocuments(
  fixture: LspFixture,
  projectRoot: string,
  relativePaths: string[],
): void {
  for (const [index, relativePath] of relativePaths.entries()) {
    const absolutePath = path.join(projectRoot, relativePath);
    assert.ok(
      fs.existsSync(absolutePath),
      `missing fixture file for ${relativePath}`,
    );
    fixture.notify("textDocument/didOpen", {
      textDocument: {
        uri: fileUri(absolutePath),
        languageId: languageId(relativePath),
        version: index + 1,
        text: fs.readFileSync(absolutePath, "utf-8"),
      },
    });
  }
}

function openExternalDocument(fixture: LspFixture, absolutePath: string): void {
  assert.ok(
    fs.existsSync(absolutePath),
    `missing external file ${absolutePath}`,
  );
  fixture.notify("textDocument/didOpen", {
    textDocument: {
      uri: fileUri(absolutePath),
      languageId: languageId(absolutePath),
      version: 1,
      text: fs.readFileSync(absolutePath, "utf-8"),
    },
  });
}

function completionItemLabel(item: unknown): string | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const label = (item as { label?: unknown }).label;
  return typeof label === "string" ? label : null;
}

function isDependencyMessageClass(messageClass: string | null): boolean {
  return (
    messageClass === "dependency-not-found" ||
    messageClass === "yaml-serialization"
  );
}

function isFusionRootDependencyBlocker(
  diagnostic: RedactedDiagnostic,
): boolean {
  return (
    diagnostic.scope === "root" &&
    diagnostic.relativePath === "dbt_project.yml" &&
    isDependencyMessageClass(diagnostic.messageClass)
  );
}

function isRootDependencyFailureEvidence(
  diagnostic: RedactedDiagnostic,
): boolean {
  return (
    diagnostic.scope === "root" &&
    isDependencyMessageClass(diagnostic.messageClass)
  );
}

function recordOpenedFiles(
  arm: ArmId,
  projectRoot: string,
  openFiles: readonly string[],
  packageSourcePath: string | null,
  completionUri: string,
): readonly string[] {
  const recorded = [...openFiles];
  if (arm === "brokenDependencyManifest" && packageSourcePath) {
    recorded.push(
      redactAbsolute(
        path.join(packageSourcePath, "dbt_project.yml"),
        projectRoot,
      ),
    );
  }
  if (arm === "control" && completionUri) {
    recorded.push("<unsaved>/ref-probe.sql");
  }
  return recorded;
}

function openUnsavedCompletionProbe(fixture: LspFixture): string {
  const uri = "file:///unsaved/ref-probe.sql";
  fixture.notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "jinja-sql",
      version: 1,
      text: INCOMPLETE_REF_TEXT,
    },
  });
  return uri;
}

function positionInsideIncompleteRef(): { line: number; character: number } {
  return { line: 0, character: INCOMPLETE_REF_TEXT.length };
}

function positionOnBaseRef(childModelText: string): {
  line: number;
  character: number;
} {
  const marker = "'base'";
  const index = childModelText.indexOf(marker);
  assert.ok(index >= 0, "child model must contain ref('base')");
  return { line: 0, character: index + 1 };
}

async function runProbe<T>(
  run: () => Promise<T>,
  classify: (value: T) => ProbeResult,
): Promise<ProbeResult> {
  try {
    return classify(await run());
  } catch (error) {
    if (error instanceof LspRequestError) {
      return {
        outcome: "error",
        errorCode: error.code,
        detail: classifyMessage(error.message),
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("timed out")) {
      return { outcome: "timeout", errorCode: null, detail: "timeout" };
    }
    return {
      outcome: "error",
      errorCode: null,
      detail: classifyMessage(message),
    };
  }
}

async function collectControlLoadProbes(
  fixture: LspFixture,
  projectRoot: string,
  completionUri: string,
): Promise<ControlLoadProbes> {
  const childModelPath = path.join(projectRoot, "models/child_model.sql");
  const childModelText = fs.readFileSync(childModelPath, "utf-8");
  const childModelUri = fileUri(childModelPath);

  const getProjectInfo = await runProbe(
    () =>
      fixture.request<{
        models_count?: number;
        models_count_is_estimate?: boolean;
      }>(
        "workspace/executeCommand",
        { command: "dbt.getProjectInfo", arguments: [] },
        PROBE_TIMEOUT_MS,
      ),
    (projectInfo) => {
      if (projectInfo === null || projectInfo === undefined) {
        return { outcome: "null", errorCode: null, detail: "null-result" };
      }
      const count = projectInfo.models_count;
      const estimate = projectInfo.models_count_is_estimate;
      if (typeof count === "number" && count > 0 && estimate === false) {
        return {
          outcome: "success",
          errorCode: null,
          detail: `models_count=${count},estimate=false`,
        };
      }
      return {
        outcome: "null",
        errorCode: null,
        detail: `models_count=${count ?? "missing"},estimate=${estimate ?? "missing"}`,
      };
    },
  );

  const completion = await runProbe(
    () =>
      fixture.request<{ items?: unknown[]; isIncomplete?: boolean }>(
        "textDocument/completion",
        {
          textDocument: { uri: completionUri },
          position: positionInsideIncompleteRef(),
        },
        PROBE_TIMEOUT_MS,
      ),
    (result) => {
      if (result === null || result === undefined) {
        return { outcome: "null", errorCode: null, detail: "null-result" };
      }
      if (!Array.isArray(result.items)) {
        return { outcome: "null", errorCode: null, detail: "missing-items" };
      }
      if (result.items.length === 0) {
        return {
          outcome: "empty",
          errorCode: null,
          detail: `empty-items,expected=${EXPECTED_COMPLETION_TARGET}`,
        };
      }
      const matched = result.items.some(
        (item) => completionItemLabel(item) === EXPECTED_COMPLETION_TARGET,
      );
      if (matched) {
        return {
          outcome: "success",
          errorCode: null,
          detail: `matched=${EXPECTED_COMPLETION_TARGET}`,
        };
      }
      return {
        outcome: "empty",
        errorCode: null,
        detail: `items=${result.items.length},no-match=${EXPECTED_COMPLETION_TARGET}`,
      };
    },
  );

  const definition = await runProbe(
    () =>
      fixture.request<{ uri?: string } | unknown[] | null>(
        "textDocument/definition",
        {
          textDocument: { uri: childModelUri },
          position: positionOnBaseRef(childModelText),
        },
        PROBE_TIMEOUT_MS,
      ),
    (result) => {
      if (result === null || result === undefined) {
        return { outcome: "null", errorCode: null, detail: "null-result" };
      }
      if (Array.isArray(result)) {
        if (result.length === 0) {
          return {
            outcome: "empty",
            errorCode: null,
            detail: "empty-locations",
          };
        }
        return {
          outcome: "success",
          errorCode: null,
          detail: "location-present",
        };
      }
      if (
        typeof result === "object" &&
        "uri" in result &&
        typeof (result as { uri?: string }).uri === "string"
      ) {
        return {
          outcome: "success",
          errorCode: null,
          detail: "location-present",
        };
      }
      return { outcome: "null", errorCode: null, detail: "unexpected-shape" };
    },
  );

  return { getProjectInfo, completion, definition };
}

async function runPullDiagnosticProbe(
  fixture: LspFixture,
  target: PullDiagnosticTarget,
): Promise<ProbeResult> {
  const uri = fileUri(target.absolutePath);
  return runProbe(
    () =>
      fixture.request<{ kind?: string; items?: unknown[] }>(
        "textDocument/diagnostic",
        { textDocument: { uri } },
        10_000,
      ),
    (result) => {
      const itemCount = Array.isArray(result?.items) ? result.items.length : 0;
      return {
        outcome: "success",
        errorCode: null,
        detail: `items=${itemCount}`,
      };
    },
  );
}

function isObservationTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("timed out");
}

async function waitForObservationWindow(
  fixture: LspFixture,
  diagnosticsCursor: number,
): Promise<number> {
  const started = Date.now();
  try {
    await fixture.waitForNotification(
      "textDocument/publishDiagnostics",
      () => true,
      OBSERVATION_MS,
      diagnosticsCursor,
    );
    await new Promise((resolve) => setTimeout(resolve, MIN_OBSERVATION_MS));
  } catch (error) {
    if (!isObservationTimeout(error)) {
      throw error;
    }
    const elapsed = Date.now() - started;
    const remaining = OBSERVATION_MS - elapsed;
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }
  return Date.now() - started;
}

async function captureArm(arm: ArmId, runIndex: number): Promise<ArmCapture> {
  const sourceRoot = fixturePath("single-project");
  const fixture = await createLspFixture(sourceRoot, sourceRoot, {
    prepareProject: armPrepare(arm),
    extraArgs: LSP_EXTRA_ARGS,
    defaultRequestTimeoutMs: REQUEST_TIMEOUT_MS,
    workspaceConfiguration: [
      {
        maxErrorReporting: 100,
        linter: { enabled: true },
        formatter: { enabled: true },
      },
    ],
  });

  try {
    const projectRoot = fixture.projectRoot;
    const pkgName = packageNameForArm(arm);
    const packageSourcePath = pkgName
      ? pkgSourceRoot(projectRoot, pkgName)
      : null;
    const packageInstalledPath = pkgName
      ? path.join(projectRoot, "dbt_packages", pkgName)
      : null;

    const deps = runDbtCommand("deps", projectRoot);
    const parse = runDbtCommand("parse", projectRoot);
    if (arm === "control") {
      assert.strictEqual(
        deps.exitCode,
        0,
        "control arm requires dbt deps exit 0",
      );
      assert.strictEqual(
        parse.exitCode,
        0,
        "control arm requires dbt parse exit 0",
      );
    }

    const timingsMs = { connect: 0, initialize: 0, observation: 0 };
    const connectStart = Date.now();
    await fixture.connect(CONNECT_TIMEOUT_MS);
    timingsMs.connect = Date.now() - connectStart;

    const initStart = Date.now();
    const initializeResult = await fixture.request<{
      capabilities?: Record<string, unknown>;
    }>("initialize", buildInitializeParams(projectRoot), REQUEST_TIMEOUT_MS);
    timingsMs.initialize = Date.now() - initStart;

    fixture.notify("initialized", {});

    const openFiles = armOpenFiles(arm);
    openDocuments(fixture, projectRoot, openFiles);
    if (arm === "brokenDependencyManifest" && packageSourcePath) {
      openExternalDocument(
        fixture,
        path.join(packageSourcePath, "dbt_project.yml"),
      );
    }
    const completionUri =
      arm === "control" ? openUnsavedCompletionProbe(fixture) : "";

    const diagnosticsStart = fixture.notificationCount(
      "textDocument/publishDiagnostics",
    );
    const progressBeforeListNodes = fixture.notificationCount("$/progress");

    try {
      await fixture.request(
        "workspace/executeCommand",
        { command: "dbt.listNodes", arguments: [] },
        10_000,
      );
    } catch {
      // Optional observation trigger only.
    }

    const observationStart = Date.now();
    try {
      timingsMs.observation = await waitForObservationWindow(
        fixture,
        diagnosticsStart,
      );
    } catch {
      timingsMs.observation = Date.now() - observationStart;
    }

    const progressPostListNodes = summarizeProgress(
      fixture
        .getNotificationEntries("$/progress")
        .filter((entry) => entry.absoluteIndex >= progressBeforeListNodes),
    );

    const publishDiagnostics = fixture
      .getNotificationEntries("textDocument/publishDiagnostics")
      .flatMap((entry) => redactDiagnostics(entry.params, projectRoot));

    const pullTarget = pullDiagnosticTarget(
      arm,
      projectRoot,
      packageSourcePath,
    );
    const pullDiagnostic = await runPullDiagnosticProbe(fixture, pullTarget);

    const loadProbes =
      arm === "control"
        ? await collectControlLoadProbes(fixture, projectRoot, completionUri)
        : "not-probed";

    const capabilityKeys = Object.keys(
      initializeResult.capabilities ?? {},
    ).sort();

    return {
      arm,
      runIndex,
      preflight: {
        depsExitCode: deps.exitCode,
        parseExitCode: parse.exitCode,
        parseErrorClass: parse.errorClass,
      },
      pathLayout: {
        project: pathDescriptor(projectRoot, projectRoot, "root"),
        packageSource:
          packageSourcePath && deps.exitCode === 0
            ? pathDescriptor(
                packageSourcePath,
                projectRoot,
                "dependency-source",
              )
            : null,
        packageInstalled:
          packageInstalledPath && fs.existsSync(packageInstalledPath)
            ? pathDescriptor(
                packageInstalledPath,
                projectRoot,
                "dependency-installed",
              )
            : null,
      },
      openedFiles: recordOpenedFiles(
        arm,
        projectRoot,
        openFiles,
        packageSourcePath,
        completionUri,
      ),
      serverArgv: redactLaunchArgs(fixture.launchArgs, projectRoot),
      initializeCapabilityKeys: capabilityKeys,
      diagnosticProviderAdvertised:
        capabilityKeys.includes("diagnosticProvider"),
      serverRegistrations: summarizeRegistrations(
        fixture.getServerRequests("client/registerCapability"),
      ),
      serverRequestMethods: [...fixture.getServerRequestMethods()],
      progressPostListNodes,
      publishDiagnostics,
      pullDiagnostic,
      pullDiagnosticPathClass: pullTarget.pathClass,
      loadProbes,
      harnessErrorClasses: fixture
        .getErrors()
        .map((entry) => classifyMessage(entry.error.message)),
      stderrLineCount: fixture.getStderr().split("\n").filter(Boolean).length,
      timingsMs,
    };
  } finally {
    await fixture.close();
  }
}

function probeSucceeded(probe: ProbeResult): boolean {
  return probe.outcome === "success";
}

function controlLoadedFromProbes(
  probes: ControlLoadProbes | "not-probed",
): boolean {
  if (probes === "not-probed") {
    return false;
  }
  return (
    probeSucceeded(probes.getProjectInfo) ||
    probeSucceeded(probes.completion) ||
    probeSucceeded(probes.definition)
  );
}

function deriveVerdict(arms: ArmCapture[]): D3Verdict {
  const controlLoaded = arms
    .filter((arm) => arm.arm === "control")
    .some((run) => controlLoadedFromProbes(run.loadProbes));
  if (!controlLoaded) {
    return {
      status: "provisional",
      reason: "control load probes did not reach success",
    };
  }

  const dependencyFailureArms = arms.filter(
    (arm) =>
      arm.arm === "dependencyModelError" ||
      arm.arm === "brokenDependencyManifest",
  );
  const anyPublishDiagnostics = dependencyFailureArms.some(
    (arm) => arm.publishDiagnostics.length > 0,
  );
  if (!anyPublishDiagnostics) {
    return {
      status: "provisional",
      reason: "no push diagnostics on dependency failure arms",
    };
  }

  const dependencyUriDiagnostics = dependencyFailureArms.flatMap((arm) =>
    arm.publishDiagnostics.filter(
      (diagnostic) => diagnostic.scope === "dependency",
    ),
  );
  const rootDependencyFailureEvidence = dependencyFailureArms.flatMap((arm) =>
    arm.publishDiagnostics.filter(isRootDependencyFailureEvidence),
  );
  const fusionRootBlocker = dependencyFailureArms.some((arm) =>
    arm.publishDiagnostics.some(isFusionRootDependencyBlocker),
  );

  if (
    dependencyUriDiagnostics.length === 0 &&
    rootDependencyFailureEvidence.length > 0
  ) {
    return { status: "decided", policy: "confinement" };
  }

  if (dependencyUriDiagnostics.length > 0) {
    return {
      status: "decided",
      policy: "filter",
      fusionRootBlocker,
      syntheticBlocker: !fusionRootBlocker,
    };
  }

  return {
    status: "provisional",
    reason:
      "dependency failure arms produced no classifiable root or dependency diagnostics",
  };
}

suite("S1 dependency diagnostics capture", function () {
  this.timeout(20 * 60 * 1000);

  const fusionVerdict = checkFusionVersion();
  const captures: ArmCapture[] = [];

  suiteSetup(function () {
    if (!s1CaptureEnabled()) {
      console.warn(
        "Skipping S1 dependency diagnostics capture: set FPU_RUN_S1_CAPTURE=1 to run.",
      );
      this.skip();
    }
    if (fusionVerdict.kind !== "ok") {
      console.warn(
        `Skipping S1 dependency diagnostics capture: ${fusionSkipReason(fusionVerdict)}.`,
      );
      this.skip();
    }
  });

  test("captures control arm (run 1)", async function () {
    captures.push(await captureArm("control", 1));
  });

  test("captures control arm (run 2)", async function () {
    captures.push(await captureArm("control", 2));
  });

  test("captures root metadata error arm", async function () {
    captures.push(await captureArm("rootMetadataError", 1));
  });

  test("captures dependency model error arm (run 1)", async function () {
    captures.push(await captureArm("dependencyModelError", 1));
  });

  test("captures dependency model error arm (run 2)", async function () {
    captures.push(await captureArm("dependencyModelError", 2));
  });

  test("captures broken dependency manifest arm", async function () {
    captures.push(await captureArm("brokenDependencyManifest", 1));
  });

  test("emits redacted capture summary", function () {
    assert.strictEqual(
      captures.length,
      EXPECTED_ARM_COUNT,
      "all capture arms must complete before summary emission",
    );

    const controlLoaded = captures
      .filter((arm) => arm.arm === "control")
      .some((run) => controlLoadedFromProbes(run.loadProbes));

    const summary: S1CaptureSummary = {
      fusionVersion: fusionVersionLabel(fusionVerdict),
      capturedAt: new Date().toISOString().slice(0, 10),
      controlLoaded,
      verdict: deriveVerdict(captures),
      arms: captures,
    };

    console.log(`FPU_S1_CAPTURE=${JSON.stringify(summary)}`);

    assert.strictEqual(summary.verdict.status, "provisional");
    assert.ok(summary.verdict.reason);

    for (const control of captures.filter((arm) => arm.arm === "control")) {
      assert.strictEqual(control.preflight.depsExitCode, 0);
      assert.strictEqual(control.preflight.parseExitCode, 0);
      assert.deepStrictEqual(control.serverArgv.slice(0, 2), [
        "lsp",
        "--socket",
      ]);
      assert.ok(
        control.serverArgv.includes("--lint-enabled") &&
          control.serverArgv.includes("true") &&
          control.serverArgv.includes("--static-analysis") &&
          control.serverArgv.includes("baseline"),
      );
      if (control.loadProbes !== "not-probed") {
        assert.ok(control.loadProbes.getProjectInfo.outcome !== undefined);
        assert.ok(control.loadProbes.completion.outcome !== undefined);
        assert.ok(control.loadProbes.definition.outcome !== undefined);
      }
    }
  });
});
