// Every export tagged `@internal` or `@planned` is checked against its production callers:
//
// - `@internal` means "exported for tests": production code (any non-test file) must still use the symbol,
//   usually inside its own module. An `@internal` export with no production reference is dead code.
// - `@planned <reason>` means "not wired yet": it must have no production reference (otherwise it is live and
//   the tag is stale) and must give a reason on the same line.
//
// knip skips both tags (knip.json `tags`), so this check is what keeps them honest. It also runs the `@port` and
// `@adapter` checks in portsAndAdapters.mjs over the host's production files.
// Usage: node scripts/quality/export-tags.mjs   (exit 1 on any finding)
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { checkPortsAndAdapters } from "./portsAndAdapters.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const PROJECTS = [
  "src/test/tsconfig.json",
  "packages/webview-contract/tsconfig.json",
  "packages/graph-layout/tsconfig.json",
  "webviews/tsconfig.test.json",
];

const isTest = (file) =>
  /\.test\.tsx?$/.test(file) ||
  /[\\/]test[\\/]/.test(path.relative(root, file));
const isSource = (file) =>
  !file.includes(`${path.sep}node_modules${path.sep}`) &&
  !file.endsWith(".d.ts");

/** A language service over one tsconfig, so find-references follows the same module resolution as tsc. */
function serviceFor(tsconfig) {
  const configPath = path.join(root, tsconfig);
  const { config } = ts.readConfigFile(configPath, (f) => ts.sys.readFile(f));
  const parsed = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath),
  );
  const versions = new Map(parsed.fileNames.map((f) => [f, "0"]));
  const host = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (f) => versions.get(f) ?? "0",
    getScriptSnapshot: (f) =>
      ts.sys.fileExists(f)
        ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f))
        : undefined,
    getCurrentDirectory: () => path.dirname(configPath),
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => ts.sys.fileExists(f),
    readFile: (f) => ts.sys.readFile(f),
    readDirectory: (...a) => ts.sys.readDirectory(...a),
    directoryExists: (d) => ts.sys.directoryExists(d),
    getDirectories: (d) => ts.sys.getDirectories(d),
  };
  return { service: ts.createLanguageService(host), files: parsed.fileNames };
}

/** The tag a declaration's JSDoc carries (`internal` or `planned`), with the text after it. */
function exportTag(node) {
  for (const tag of ts.getJSDocTags(node)) {
    const name = tag.tagName.text;
    if (name === "internal" || name === "planned") {
      const comment =
        typeof tag.comment === "string"
          ? tag.comment
          : ts.getTextOfJSDocComment(tag.comment);
      return { name, comment: (comment ?? "").trim() };
    }
  }
  return undefined;
}

const isExported = (node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword,
  );

/** Exported top-level declarations with their name node and the node that carries the JSDoc. */
function* taggedExports(sf) {
  for (const stmt of sf.statements) {
    if (!isExported(stmt)) {
      continue;
    }
    const tag = exportTag(stmt);
    if (!tag) {
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) {
          yield { name: d.name, tag };
        }
      }
    } else if (stmt.name && ts.isIdentifier(stmt.name)) {
      yield { name: stmt.name, tag };
    }
  }
}

const findings = [];
const seen = new Set();
for (const tsconfig of PROJECTS) {
  const { service, files } = serviceFor(tsconfig);
  const program = service.getProgram();
  if (tsconfig === "src/test/tsconfig.json") {
    const production = files
      .filter((f) => isSource(f) && !isTest(f))
      .map((f) => program.getSourceFile(f))
      .filter(Boolean);
    findings.push(...checkPortsAndAdapters(program, production, root));
  }
  for (const file of files) {
    if (!isSource(file) || isTest(file) || seen.has(file)) {
      continue;
    }
    seen.add(file);
    const sf = program.getSourceFile(file);
    if (!sf) {
      continue;
    }
    for (const { name, tag } of taggedExports(sf)) {
      const refs = (
        service.findReferences(file, name.getStart(sf)) ?? []
      ).flatMap((s) => s.references);
      const production = refs.filter(
        (r) =>
          !r.isDefinition &&
          isSource(r.fileName) &&
          !isTest(r.fileName) &&
          !r.isInString,
      );
      const where = `${path.relative(root, file)}:${sf.getLineAndCharacterOfPosition(name.getStart(sf)).line + 1}`;
      if (tag.name === "internal" && production.length === 0) {
        findings.push(
          `${where} ${name.text}: @internal but no production code uses it. Delete it, or tag it @planned <reason>.`,
        );
      }
      if (tag.name === "planned" && production.length > 0) {
        const at = production[0];
        findings.push(
          `${where} ${name.text}: @planned but used in ${path.relative(root, at.fileName)}. Drop the tag.`,
        );
      }
      if (tag.name === "planned" && tag.comment.length === 0) {
        findings.push(
          `${where} ${name.text}: @planned needs a reason: \`@planned <what will call it>\`.`,
        );
      }
    }
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `export-tags: ${seen.size} production files, every @internal and @planned export checked`,
  );
}
