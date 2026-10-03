import * as path from "path";
import {
  Diagnostic,
  DiagnosticSeverity,
  Disposable,
  languages,
  Range,
  Uri,
} from "vscode";
import { DBTDiagnosticData } from "../dbt_integration";
import { EXECUTABLE_DIAGNOSTIC_SOURCE } from "../fusion/executableLifecycle";
import { isWithinRoot } from "../fusion/fusionDiagnostics";

/** The origin of a group of project diagnostics; each kind is replaced independently. */
export type ProjectDiagnosticKind =
  "rebuild-manifest" | "project-config" | "fusion-executable";

function toSeverity(severity: string): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Error;
  }
}

function isExecutable(data: DBTDiagnosticData): boolean {
  return data.source === EXECUTABLE_DIAGNOSTIC_SOURCE;
}

function toDiagnostic(
  data: DBTDiagnosticData,
  kind: ProjectDiagnosticKind,
): Diagnostic {
  const diagnostic = new Diagnostic(
    new Range(
      data.range?.startLine ?? 0,
      data.range?.startColumn ?? 0,
      data.range?.endLine ?? 999,
      data.range?.endColumn ?? 999,
    ),
    data.message,
    toSeverity(data.severity),
  );
  diagnostic.source = "Fusion Power User";
  diagnostic.code = kind;
  return diagnostic;
}

/**
 * A project's Problems-panel diagnostics, each published on the file its data names, or on `dbt_project.yml` when
 * that file lies outside the project.
 */
export class ProjectDiagnostics implements Disposable {
  private readonly collection = languages.createDiagnosticCollection(
    "fusionPowerUser.project",
  );
  private readonly byKind = new Map<
    ProjectDiagnosticKind,
    [string, Diagnostic][]
  >([
    ["rebuild-manifest", []],
    ["project-config", []],
    ["fusion-executable", []],
  ]);
  private config: DBTDiagnosticData[] = [];
  private disposed = false;

  constructor(private readonly file: Uri) {}

  /** Adds a project-config diagnostic; executable-resolution data publishes as `fusion-executable`. */
  addConfig(data: DBTDiagnosticData): void {
    this.config.push(data);
    this.publishConfig();
  }

  /** Clears every project-config and executable diagnostic. */
  clearConfig(): void {
    this.config = [];
    this.publishConfig();
  }

  /** Replaces the executable-resolution diagnostics with `data`, or clears them. */
  replaceExecutable(data: DBTDiagnosticData | undefined): void {
    this.config = this.config.filter((entry) => !isExecutable(entry));
    if (data) {
      this.config.push(data);
    }
    this.publishConfig();
  }

  private publishConfig(): void {
    this.setKind(
      "project-config",
      this.config.filter((data) => !isExecutable(data)),
    );
    this.setKind("fusion-executable", this.config.filter(isExecutable));
  }

  /** Replaces one kind's diagnostics and publishes every kind. */
  setKind(
    kind: ProjectDiagnosticKind,
    data: readonly DBTDiagnosticData[],
  ): void {
    if (this.disposed) {
      return;
    }
    this.byKind.set(
      kind,
      data.map((entry) => [this.fileOf(entry), toDiagnostic(entry, kind)]),
    );
    const byFile = new Map<string, Diagnostic[]>();
    for (const [file, diagnostic] of [...this.byKind.values()].flat()) {
      byFile.set(file, [...(byFile.get(file) ?? []), diagnostic]);
    }
    this.collection.clear();
    if (byFile.size === 0) {
      this.collection.set(this.file, []);
    }
    for (const [file, diagnostics] of byFile) {
      this.collection.set(
        file === this.file.fsPath ? this.file : Uri.file(file),
        diagnostics,
      );
    }
  }

  private fileOf(data: DBTDiagnosticData): string {
    const root = path.dirname(this.file.fsPath);
    return data.filePath && isWithinRoot(data.filePath, root)
      ? data.filePath
      : this.file.fsPath;
  }

  /** Every published diagnostic. */
  all(): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    this.collection.forEach((_, entries) => diagnostics.push(...entries));
    return diagnostics;
  }

  /** The first published diagnostic with error severity. */
  firstError(): Diagnostic | undefined {
    return this.all().find(
      (diagnostic) => diagnostic.severity === DiagnosticSeverity.Error,
    );
  }

  /** Throws the first published error diagnostic's message, if any. */
  throwFirstError(): void {
    const error = this.firstError();
    if (error) {
      throw new Error(error.message);
    }
  }

  /** Disposes the collection; later updates are ignored. */
  dispose(): void {
    this.disposed = true;
    this.collection.dispose();
  }
}
