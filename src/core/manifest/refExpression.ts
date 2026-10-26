/**
 * The `ref()` and `source()` expressions that appear in constraint `to` fields, semantic-model `model` fields and
 * model bodies. Every consumer parses them here.
 */
export type RefExpression =
  | { kind: "ref"; name: string; package?: string; version?: string }
  | { kind: "source"; source: string; table: string };

// Arguments are quoted with either quote character. The version is the last argument, after the name: `v=2`,
// `version=2` or a bare value.
const REF_CALL =
  /^ref\s*\(\s*['"]([^'"]+)['"](?:\s*,\s*['"]([^'"]+)['"])?(?:\s*,\s*(?:(?:v|version)\s*=\s*)?([^,)]+?))?\s*\)$/;
const SOURCE_CALL =
  /^source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/;

/**
 * Parses one `ref(...)` or `source(...)` expression, surrounding whitespace allowed. The two-argument ref is
 * `ref('package', 'name')`: `package` is the first argument and `name` the second.
 */
export function parseRefExpression(text: string): RefExpression | undefined {
  const trimmed = text.trim();
  const ref = REF_CALL.exec(trimmed);
  if (ref) {
    const first = ref[1] ?? "";
    const second = ref[2];
    const version = ref[3]?.trim().replaceAll(/['"]/g, "");
    return {
      kind: "ref",
      name: second ?? first,
      ...(second === undefined ? {} : { package: first }),
      ...(version ? { version } : {}),
    };
  }
  const source = SOURCE_CALL.exec(trimmed);
  if (source) {
    return { kind: "source", source: source[1] ?? "", table: source[2] ?? "" };
  }
  return undefined;
}

/** True when `body` calls `ref('name')`, or `ref('pkg', 'name')` when `pkg` is given. */
export function containsRefCall(
  body: string,
  name: string,
  pkg?: string,
): boolean {
  const simple = new RegExp(
    `ref\\s*\\(\\s*['"]${escapeRegex(name)}['"]\\s*[,)]`,
  );
  if (simple.test(body)) {
    return true;
  }
  if (pkg) {
    const qualified = new RegExp(
      `ref\\s*\\(\\s*['"]${escapeRegex(pkg)}['"]\\s*,\\s*['"]${escapeRegex(name)}['"]\\s*[,)]`,
    );
    if (qualified.test(body)) {
      return true;
    }
  }
  return false;
}

/** True when `body` calls `source('sourceName', 'tableName')`. */
export function containsSourceCall(
  body: string,
  sourceName: string,
  tableName: string,
): boolean {
  const re = new RegExp(
    `source\\s*\\(\\s*['"]${escapeRegex(sourceName)}['"]\\s*,\\s*['"]${escapeRegex(tableName)}['"]\\s*\\)`,
  );
  return re.test(body);
}

function escapeRegex(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
