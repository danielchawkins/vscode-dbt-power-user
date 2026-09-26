import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const srcRoot = path.join(repositoryRoot, "src");

const forbiddenInProductionSource: Array<{ label: string; pattern: RegExp }> = [
  { label: "createPythonBridge", pattern: /\bcreatePythonBridge\b/ },
  { label: "ms-python.python", pattern: /ms-python\.python/ },
  { label: "dbtPythonPathOverride", pattern: /dbtPythonPathOverride/ },
  { label: "detectPythonFromTerminal", pattern: /detectPythonFromTerminal/ },
  { label: "dbtCustomRunnerImport", pattern: /dbtCustomRunnerImport/ },
  {
    label: "extension-owned PythonEnvironment class",
    pattern: /\bPythonEnvironment\b(?!Provider)/,
  },
  { label: "node_python_bridge.py", pattern: /node_python_bridge\.py/ },
  { label: "altimate_python_packages", pattern: /altimate_python_packages/ },
  { label: "dbt_core_integration.py", pattern: /dbt_core_integration\.py/ },
  {
    label: "@altimateai/dbt-integration",
    pattern: /@altimateai\/dbt-integration/,
  },
];

const forbiddenInPackageJson: Array<{ label: string; pattern: RegExp }> = [
  { label: "ms-python.python dependency", pattern: /ms-python\.python/ },
  { label: "dbtPythonPathOverride setting", pattern: /dbtPythonPathOverride/ },
  { label: "dbtCustomRunnerImport setting", pattern: /dbtCustomRunnerImport/ },
  {
    label: "installDepsOnProjectInitialization setting",
    pattern: /installDepsOnProjectInitialization/,
  },
  { label: "sqlFmtPath setting", pattern: /sqlFmtPath/ },
  {
    label: "@altimateai/dbt-integration dependency",
    pattern: /@altimateai\/dbt-integration/,
  },
  { label: "printEnvVars command", pattern: /\bprintEnvVars\b/ },
  {
    label: "detectPythonFromTerminal command",
    pattern: /\bdetectPythonFromTerminal\b/,
  },
];

function listProductionSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "test") {
        continue;
      }
      files.push(...listProductionSourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("Python bridge removal guards", () => {
  it("has no forbidden Python-bridge symbols in production source", () => {
    const hits: string[] = [];
    for (const filePath of listProductionSourceFiles(srcRoot)) {
      const relativePath = path.relative(repositoryRoot, filePath);
      const contents = readFileSync(filePath, "utf8");
      for (const { label, pattern } of forbiddenInProductionSource) {
        if (pattern.test(contents)) {
          hits.push(`${relativePath}: ${label}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("has no Python-bridge surfaces in package.json or launch.json", () => {
    const hits: string[] = [];
    for (const [relativePath, contents] of [
      [
        "package.json",
        readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
      ],
      [
        ".vscode/launch.json",
        readFileSync(path.join(repositoryRoot, ".vscode/launch.json"), "utf8"),
      ],
    ] as const) {
      for (const { label, pattern } of forbiddenInPackageJson) {
        if (pattern.test(contents)) {
          hits.push(`${relativePath}: ${label}`);
        }
      }
      if (
        relativePath === ".vscode/launch.json" &&
        /"type"\s*:\s*"python"/.test(contents)
      ) {
        hits.push(`${relativePath}: python launch configuration`);
      }
    }
    expect(hits).toEqual([]);
  });
});
