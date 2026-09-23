import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import ts from "typescript";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const srcRoot = path.join(repositoryRoot, "src");
const packageJsonPath = path.join(repositoryRoot, "package.json");

function scanCommandRegistrations() {
  const literals = new Set<string>();
  const nonLiterals = new Map<string, string>();

  function scanFile(filePath: string): void {
    const relPath = path.relative(srcRoot, filePath);
    const content = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
    );

    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callExpr = node as ts.CallExpression;
        const { expression: callee } = callExpr;

        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "commands" &&
          (callee.name.text === "registerCommand" ||
            callee.name.text === "registerTextEditorCommand") &&
          callExpr.arguments.length > 0
        ) {
          const arg0 = callExpr.arguments[0];
          if (
            ts.isStringLiteral(arg0) ||
            ts.isNoSubstitutionTemplateLiteral(arg0)
          ) {
            const cmd = arg0.text;
            if (cmd.startsWith("dbtPowerUser.")) {
              literals.add(cmd);
            }
          } else {
            const expr = arg0.getText(sourceFile).substring(0, 80);
            nonLiterals.set(`${relPath}:${expr}`, expr);
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  function walkDir(dir: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const stat = statSync(entryPath);
      if (stat.isDirectory()) {
        if (
          !entry.startsWith(".") &&
          entry !== "node_modules" &&
          entry !== "test" &&
          entry !== "dist"
        ) {
          walkDir(entryPath);
        }
      } else if (
        stat.isFile() &&
        entry.endsWith(".ts") &&
        !entry.endsWith(".d.ts")
      ) {
        scanFile(entryPath);
      }
    }
  }

  walkDir(srcRoot);
  return { literals, nonLiterals };
}

function getContributedCommands(): Set<string> {
  const content = readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as {
    contributes?: { commands?: Array<{ command: string }> };
  };
  const contributed = new Set<string>();
  for (const cmd of packageJson.contributes?.commands ?? []) {
    contributed.add(cmd.command);
  }
  return contributed;
}

describe("command contribution consistency", () => {
  it("enforces command consistency with allowlists", () => {
    const contributed = getContributedCommands();
    const { literals, nonLiterals } = scanCommandRegistrations();

    const literalUncontributedAllowlist: Record<string, string> = {
      "dbtPowerUser.checkIfDbtIsInstalled":
        "Dead registration pending cleanup; src/commands",
      "dbtPowerUser.associateFileExts":
        "Dead registration pending cleanup; src/commands",
      "dbtPowerUser.createModelBasedonSourceConfig":
        "CodeLens-only; src/code_lens_provider",
      "dbtPowerUser.runCteWithDependencies":
        "CodeLens-only; src/code_lens_provider",
      "dbtPowerUser.runSelectedQuery":
        "Dead registration pending cleanup; src/commands",
      "dbtPowerUser.yamlRunModel": "CodeLens-only; src/code_lens_provider",
      "dbtPowerUser.yamlTestModel": "CodeLens-only; src/code_lens_provider",
      "dbtPowerUser.pickProject": "CodeLens-only; src/code_lens_provider",
    };

    const nonLiteralAllowlist: Record<string, string> = {
      "benchmark/runtimeTimings.ts:RUNTIME_TIMINGS_COMMAND":
        "Constant export; conditional registration",
    };

    const orphans = Array.from(contributed).filter((cmd) => !literals.has(cmd));
    const uncontributed = Array.from(literals)
      .filter(
        (cmd) => !contributed.has(cmd) && !literalUncontributedAllowlist[cmd],
      )
      .sort();
    const discoveredNonLiterals = Array.from(nonLiterals.keys()).sort();
    const allowedNonLiterals = Object.keys(nonLiteralAllowlist).sort();

    expect(orphans.sort()).toEqual([]);
    expect(uncontributed).toEqual([]);
    expect(discoveredNonLiterals).toEqual(allowedNonLiterals);

    for (const cmd of Object.keys(literalUncontributedAllowlist)) {
      const valid =
        literals.has(cmd) &&
        !contributed.has(cmd) &&
        literalUncontributedAllowlist[cmd].length > 0;
      if (!valid) {
        throw new Error(
          `Allowlist entry invalid: "${cmd}": ${literalUncontributedAllowlist[cmd]}`,
        );
      }
    }
  });
});
