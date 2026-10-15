// `@port` marks an interface or type alias a folder declares for code outside it to implement; `@adapter` marks a
// class or factory function that implements one. The checks, over production files only:
//
// 1. An `@adapter` class implements a `@port`; an `@adapter` function's declared return type is a `@port`.
// 2. A class that implements a `@port`, or a function whose declared return type is one, is tagged `@adapter`.
// 3. An adapter lives outside its port's top-level folder, and no file in that folder imports the adapter's module.
// 4. An adapter is constructed (`new`, or a call of an adapter function) only in compositionRoot.ts or inside
//    another adapter.
// 5. Every `@port` has at least one adapter.
import path from "node:path";
import ts from "typescript";

const hasTag = (node, name) =>
  ts.getJSDocTags(node).some((t) => t.tagName.text === name);

/** `src/<folder>` for a file under a folder of `src/`, else the file's own directory. */
const topFolder = (root, file) => {
  const parts = path.relative(root, file).split(path.sep);
  return parts.length > 2
    ? parts.slice(0, 2).join("/")
    : parts.slice(0, -1).join("/");
};

const resolved = (checker, node) => {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
};

/** Ports, adapters and every class or function that could be one, from top-level statements. */
function collect(program, checker, files) {
  const ports = new Map();
  const candidates = [];
  for (const sf of files) {
    for (const stmt of sf.statements) {
      const isType =
        ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt);
      if (isType && hasTag(stmt, "port")) {
        ports.set(checker.getSymbolAtLocation(stmt.name), {
          name: stmt.name.text,
          file: sf.fileName,
        });
      }
      if (
        (ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) &&
        stmt.name
      ) {
        candidates.push({
          node: stmt,
          sf,
          symbol: checker.getSymbolAtLocation(stmt.name),
        });
      }
    }
  }
  return { ports, candidates };
}

/** The `@port` symbols a class implements, or a function's declared return type names. */
function portsOf(checker, ports, node) {
  const types = ts.isClassDeclaration(node)
    ? (node.heritageClauses ?? [])
        .filter((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
        .flatMap((h) => h.types.map((t) => t.expression))
    : node.type && ts.isTypeReferenceNode(node.type)
      ? [node.type.typeName]
      : [];
  return types.map((t) => resolved(checker, t)).filter((s) => ports.has(s));
}

/** Each `new X(…)` or `x(…)` whose callee resolves to an adapter, with the enclosing top-level statement. */
function* constructions(checker, adapters, sf) {
  const visit = function* (node, top) {
    const callee =
      ts.isNewExpression(node) || ts.isCallExpression(node)
        ? node.expression
        : undefined;
    if (callee) {
      const symbol = resolved(checker, callee);
      if (adapters.has(symbol)) {
        yield { node, top, symbol };
      }
    }
    for (const child of node.getChildren(sf)) {
      yield* visit(child, top);
    }
  };
  for (const stmt of sf.statements) {
    yield* visit(stmt, stmt);
  }
}

/** Files under `folder` that import `file`. */
const importersIn = ({ checker, files, root }, folder, file) =>
  files.filter(
    (sf) =>
      topFolder(root, sf.fileName) === folder &&
      sf.statements.some(
        (s) =>
          (ts.isImportDeclaration(s) || ts.isExportDeclaration(s)) &&
          s.moduleSpecifier &&
          checker.getSymbolAtLocation(s.moduleSpecifier)?.valueDeclaration
            ?.fileName === file,
      ),
  );

/**
 * Findings for the port and adapter rules over `files`, the production source files of `program`.
 * @param {string} root repository root, for folder names and messages
 */
export function checkPortsAndAdapters(program, files, root) {
  const checker = program.getTypeChecker();
  const findings = [];
  const where = (sf, node) =>
    `${path.relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
  const { ports, candidates } = collect(program, checker, files);
  const adapters = new Map();
  const implemented = new Set();
  for (const { node, sf, symbol } of candidates) {
    const implementing = portsOf(checker, ports, node);
    const tagged = hasTag(node, "adapter");
    const name = node.name.text;
    if (tagged && implementing.length === 0) {
      findings.push(
        `${where(sf, node)} ${name}: @adapter but implements no @port.`,
      );
    }
    if (!tagged && implementing.length > 0) {
      findings.push(
        `${where(sf, node)} ${name}: implements @port ${ports.get(implementing[0]).name}; tag it @adapter.`,
      );
    }
    if (!tagged || implementing.length === 0) {
      continue;
    }
    adapters.set(symbol, { name, file: sf.fileName });
    for (const port of implementing) {
      implemented.add(port);
      const portFolder = topFolder(root, ports.get(port).file);
      if (topFolder(root, sf.fileName) === portFolder) {
        findings.push(
          `${where(sf, node)} ${name}: lives in ${portFolder}/, the folder of its port.`,
        );
      }
      for (const importer of importersIn(
        { checker, files, root },
        portFolder,
        sf.fileName,
      )) {
        findings.push(
          `${path.relative(root, importer.fileName)}: imports adapter ${name} into its port's folder.`,
        );
      }
    }
  }
  for (const sf of files) {
    const isRoot = path.basename(sf.fileName) === "compositionRoot.ts";
    for (const { node, top, symbol } of constructions(checker, adapters, sf)) {
      const inAdapter =
        top.name && adapters.has(checker.getSymbolAtLocation(top.name));
      if (!isRoot && !inAdapter) {
        findings.push(
          `${where(sf, node)}: constructs adapter ${adapters.get(symbol).name} outside compositionRoot.`,
        );
      }
    }
  }
  for (const [symbol, port] of ports) {
    if (!implemented.has(symbol)) {
      findings.push(
        `${path.relative(root, port.file)} ${port.name}: @port with no @adapter.`,
      );
    }
  }
  return findings;
}
