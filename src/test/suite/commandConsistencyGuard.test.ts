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
            if (cmd.startsWith("fusionPowerUser.")) {
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

type MenuEntry = { command?: string; submenu?: string; when?: string };

type PackageJsonContributes = {
  commands?: Array<{ command: string }>;
  menus?: Record<string, MenuEntry[]>;
  submenus?: Array<{ id: string }>;
  keybindings?: Array<{ command: string }>;
  [contributionPoint: string]: unknown;
};

function readContributes(): PackageJsonContributes {
  const content = readFileSync(packageJsonPath, "utf8");
  const packageJson = JSON.parse(content) as {
    contributes: PackageJsonContributes;
  };
  return packageJson.contributes;
}

function getContributedCommands(contributes: PackageJsonContributes) {
  const contributed = new Set<string>();
  for (const cmd of contributes.commands ?? []) {
    contributed.add(cmd.command);
  }
  return contributed;
}

// Commands reachable only with a tree-item or context argument crash when VS
// Code invokes them from the command palette with no argument. They must be
// hidden there with a `menus.commandPalette` entry of `"when": "false"`.
const paletteHiddenCommands = [
  "fusionPowerUser.rerunFromHistory",
  "fusionPowerUser.copyModelName",
];

// The complete set of `contributes` keys this extension uses. A key must be
// added here deliberately, so a stray or copy-pasted contribution point
// cannot land silently.
const knownContributionPoints = new Set([
  "snippets",
  "configuration",
  "viewsContainers",
  "views",
  "commands",
  "keybindings",
  "menus",
  "submenus",
  "languages",
  "grammars",
]);

describe("command contribution consistency", () => {
  const contributes = readContributes();

  it("enforces command consistency with allowlists", () => {
    const contributed = getContributedCommands(contributes);
    const { literals, nonLiterals } = scanCommandRegistrations();

    const literalUncontributedAllowlist: Record<string, string> = {
      "fusionPowerUser.createModelBasedonSourceConfig":
        "CodeLens-only; src/code_lens_provider",
      "fusionPowerUser.runCteWithDependencies":
        "CodeLens-only; src/code_lens_provider",
      "fusionPowerUser.yamlRunModel": "CodeLens-only; src/code_lens_provider",
      "fusionPowerUser.yamlTestModel": "CodeLens-only; src/code_lens_provider",
      "fusionPowerUser.pickProject": "Declared Project picker; src/quickpick",
    };

    const nonLiteralAllowlist: Record<string, string> = {
      "benchmark/runtimeTimings.ts:RUNTIME_TIMINGS_COMMAND":
        "Constant export; conditional registration",
      "lsp/fusionClientDiagnostics.ts:FUSION_CLIENT_STATES_COMMAND":
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

  it("only contributes known contribution points", () => {
    const unknown = Object.keys(contributes).filter(
      (key) => !knownContributionPoints.has(key),
    );

    expect(unknown).toEqual([]);
  });

  it("every submenu id is declared and has a menu of its own", () => {
    const submenuIds = new Set(
      (contributes.submenus ?? []).map((submenu) => submenu.id),
    );
    const menus = contributes.menus ?? {};
    const referencedSubmenus = new Set<string>();

    for (const entries of Object.values(menus)) {
      for (const entry of entries) {
        if (entry.submenu) {
          referencedSubmenus.add(entry.submenu);
        }
      }
    }

    const undeclaredReferences = Array.from(referencedSubmenus).filter(
      (id) => !submenuIds.has(id),
    );
    const menuless = Array.from(submenuIds).filter((id) => !(id in menus));

    expect(undeclaredReferences).toEqual([]);
    expect(menuless).toEqual([]);
  });

  it("every menu and keybinding command is contributed", () => {
    const contributed = getContributedCommands(contributes);
    const menus = contributes.menus ?? {};
    const referencedCommands = new Set<string>();

    for (const entries of Object.values(menus)) {
      for (const entry of entries) {
        if (entry.command) {
          referencedCommands.add(entry.command);
        }
      }
    }
    for (const keybinding of contributes.keybindings ?? []) {
      referencedCommands.add(keybinding.command);
    }

    const orphanReferences = Array.from(referencedCommands)
      .filter((cmd) => !contributed.has(cmd))
      .sort();

    expect(orphanReferences).toEqual([]);
  });

  it("hides tree- and context-only commands from the command palette", () => {
    const commandPaletteEntries = contributes.menus?.commandPalette ?? [];
    const hidden = new Set(
      commandPaletteEntries
        .filter((entry) => entry.when === "false")
        .map((entry) => entry.command),
    );

    const missing = paletteHiddenCommands.filter((cmd) => !hidden.has(cmd));

    expect(missing).toEqual([]);
  });
});
