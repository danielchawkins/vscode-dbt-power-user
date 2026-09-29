import {
  Diagnostic,
  DiagnosticSeverity,
  Disposable,
  languages,
  Range,
  Uri,
} from "vscode";
import { DBTDiagnosticData } from "../dbt_integration";

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

function toDiagnostic(
  data: DBTDiagnosticData,
  kind: ProjectDiagnosticKind,
): Diagnostic {
  const diagnostic = new Diagnostic(
    new Range(
      data.range?.startLine || 0,
      data.range?.startColumn || 0,
      data.range?.endLine || 999,
      data.range?.endColumn || 999,
    ),
    data.message,
    toSeverity(data.severity),
  );
  diagnostic.source = "Fusion Power User";
  diagnostic.code = kind;
  return diagnostic;
}

/** A project's Problems-panel diagnostics, published on its `dbt_project.yml`. */
export class ProjectDiagnostics implements Disposable {
  private readonly collection = languages.createDiagnosticCollection(
    "fusionPowerUser.project",
  );
  private readonly byKind = new Map<ProjectDiagnosticKind, Diagnostic[]>();

  constructor(private readonly file: Uri) {}

  /** Replaces one kind's diagnostics and publishes every kind. */
  setKind(
    kind: ProjectDiagnosticKind,
    data: readonly DBTDiagnosticData[],
  ): void {
    this.byKind.set(
      kind,
      data.map((entry) => toDiagnostic(entry, kind)),
    );
    this.collection.set(this.file, [...this.byKind.values()].flat());
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

  dispose(): void {
    this.collection.dispose();
  }
}
