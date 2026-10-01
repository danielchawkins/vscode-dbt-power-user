import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
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
          ((ts.isIdentifier(callee.expression) &&
            callee.expression.text === "commands" &&
            (callee.name.text === "registerCommand" ||
              callee.name.text === "registerTextEditorCommand")) ||
            (callee.expression.kind === ts.SyntaxKind.ThisKeyword &&
              callee.name.text === "register")) &&
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

/** `command: "..."` literals in source files that create language status items. */
function scanLanguageStatusCommands(): string[] {
  const found = new Set<string>();
  const visitDir = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const entryPath = path.join(dir, entry);
      if (statSync(entryPath).isDirectory()) {
        if (entry !== "test" && !entry.startsWith(".")) {
          visitDir(entryPath);
        }
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) {
        continue;
      }
      const content = readFileSync(entryPath, "utf8");
      if (!content.includes("createLanguageStatusItem")) {
        continue;
      }
      const sourceFile = ts.createSourceFile(
        entryPath,
        content,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "command" &&
          ts.isStringLiteral(node.initializer)
        ) {
          found.add(node.initializer.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  };
  visitDir(srcRoot);
  return Array.from(found).sort();
}

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
  "semanticTokenScopes",
  "taskDefinitions",
]);

describe("command contribution consistency", () => {
  const contributes = readContributes();

  it("enforces command consistency with allowlists", () => {
    const contributed = getContributedCommands(contributes);
    const { literals, nonLiterals } = scanCommandRegistrations();

    const literalUncontributedAllowlist: Record<string, string> = {
      "fusionPowerUser.createModelBasedonSourceConfig":
        "CodeLens-only; src/features/codegen",
      "fusionPowerUser.runCteWithDependencies":
        "CodeLens-only; src/features/cte",
      "fusionPowerUser.yamlRunModel": "CodeLens-only; src/features/sqlActions",
      "fusionPowerUser.yamlTestModel": "CodeLens-only; src/features/sqlActions",
      "fusionPowerUser.pickProject":
        "Declared Project picker; src/features/projectPicker/actionsCenter.ts",
      "fusionPowerUser.showFusionOutput":
        "Language status item command; src/fusion/fusionStatus.ts",
    };

    const nonLiteralAllowlist: Record<string, string> = {
      "features/commands.ts:command":
        "`VSCodeCommands.register` forwards a literal from its callers",
      "benchmark/runtimeTimings.ts:RUNTIME_TIMINGS_COMMAND":
        "Constant export; conditional registration",
      "fusion/fusionClientDiagnostics.ts:FUSION_CLIENT_STATES_COMMAND":
        "Constant export; conditional registration",
      "features/lineage/connectedColumnsCommand.ts:CONNECTED_COLUMNS_COMMAND":
        "Constant export; conditional registration",
      "features/lineage/connectedColumnsCommand.ts:PARENT_TABLES_COMMAND":
        "Constant export; conditional registration",
      "features/lineage/connectedColumnsCommand.ts:LINEAGE_COLUMNS_COMMAND":
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

  it("every language status item command is contributed or registered", () => {
    const contributed = getContributedCommands(contributes);
    const { literals } = scanCommandRegistrations();
    const referenced = scanLanguageStatusCommands();

    expect(referenced.length).toBeGreaterThan(0);
    expect(
      referenced.filter((cmd) => !contributed.has(cmd) && !literals.has(cmd)),
    ).toEqual([]);
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

describe("language contribution consistency", () => {
  const contributes = readContributes() as PackageJsonContributes & {
    languages?: Array<{ id: string; filenamePatterns?: string[] }>;
  };
  // Languages VS Code ships; the extension only adds filename patterns to `sql`.
  const builtInLanguages = new Set(["sql", "yaml"]);
  const contributedLanguages = new Set(
    (contributes.languages ?? []).map(({ id }) => id),
  );
  const known = (id: string) =>
    contributedLanguages.has(id) || builtInLanguages.has(id);

  it("contributes jinja-sql and every language with filename patterns", () => {
    expect(contributedLanguages.has("jinja-sql")).toBe(true);
    for (const language of contributes.languages ?? []) {
      expect(language.filenamePatterns?.length, language.id).toBeGreaterThan(0);
    }
  });

  it("names only known languages in when clauses", () => {
    const text = readFileSync(packageJsonPath, "utf8");
    const ids = new Set<string>();
    for (const match of text.matchAll(
      /(?:editorLangId|resourceLangId)\s*(?:==|!=)\s*([\w-]+)/g,
    )) {
      ids.add(match[1]);
    }
    for (const match of text.matchAll(
      /(?:editorLangId|resourceLangId)\s*=~\s*\/([^/]+)\//g,
    )) {
      for (const alternative of match[1].split("|")) {
        ids.add(alternative.replace(/^\^|\$$/g, ""));
      }
    }

    expect(ids.size).toBeGreaterThan(0);
    expect([...ids].filter((id) => !known(id))).toEqual([]);
  });

  it("scopes language status items and selectors to known languages", () => {
    const languageLiterals = new Set<string>();
    const visitDir = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const entryPath = path.join(dir, entry);
        if (statSync(entryPath).isDirectory()) {
          if (entry !== "test" && !entry.startsWith(".")) {
            visitDir(entryPath);
          }
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) {
          continue;
        }
        const content = readFileSync(entryPath, "utf8");
        for (const match of content.matchAll(
          /\blanguage:\s*"([\w-]+)"|FUSION_DOCUMENT_LANGUAGES = \[([^\]]+)\]/g,
        )) {
          const literals = match[1]
            ? [match[1]]
            : [...match[2].matchAll(/"([\w-]+)"/g)].map((m) => m[1]);
          literals.forEach((id) => languageLiterals.add(id));
        }
      }
    };
    visitDir(srcRoot);

    expect(languageLiterals.has("jinja-sql")).toBe(true);
    expect([...languageLiterals].filter((id) => !known(id))).toEqual([]);
  });
});

describe("semantic token scopes", () => {
  // Fusion 2.0.6 initialize legend; recorded by scripts/evidence/steps/editor-features.json.
  const fusionTokenTypes = new Set([
    "property",
    "function",
    "macro",
    "type",
    "variable",
    "keyword",
  ]);

  it("overrides only Fusion token types, for both languages Fusion serves", () => {
    const contributes = readContributes() as unknown as {
      semanticTokenScopes: {
        language: string;
        scopes: Record<string, string[]>;
      }[];
    };
    const entries = contributes.semanticTokenScopes;

    expect(entries.map((e) => e.language).sort()).toEqual(["jinja-sql", "sql"]);
    for (const entry of entries) {
      expect(
        Object.keys(entry.scopes).filter((t) => !fusionTokenTypes.has(t)),
      ).toEqual([]);
    }
  });

  it("keeps ref and source on the grammar's dbt scope instead of the keyword fallback", () => {
    const contributes = readContributes() as unknown as {
      semanticTokenScopes: {
        language: string;
        scopes: Record<string, string[]>;
      }[];
    };
    for (const entry of contributes.semanticTokenScopes) {
      expect(entry.scopes.keyword).toEqual(["support.function.dbt.jinja"]);
    }
  });
});
