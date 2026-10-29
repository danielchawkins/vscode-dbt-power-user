export interface DiagnosticData {
  filePath: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  range?: {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  };
  source: string;
  category: string;
}

export interface DiagnosticResult {
  rebuildManifestDiagnostics: DiagnosticData[];
  projectConfigDiagnostics: DiagnosticData[];
}
