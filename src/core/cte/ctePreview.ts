/** A CTE as the language server's `dbt.previewCte` lens describes it. */
export interface FusionCte {
  name: string;
  /** The compiled file the offsets index into, as the server returned it. */
  compiledPath: string;
  /** UTF-8 byte offset of `with` in the compiled file. */
  compiledStart: number;
  /** UTF-8 byte offset of the end of this CTE's body, before its closing parenthesis. */
  compiledStop: number;
  /** 0-based line of the lens in the source document. */
  line: number;
}

/** The CTE in the second argument of a `dbt.previewCte` lens; `undefined` for any other shape. */
export function fusionCteFromLens(
  raw: unknown,
  line: number,
): FusionCte | undefined {
  const cte = raw as Record<string, unknown> | null | undefined;
  if (
    typeof cte?.name !== "string" ||
    typeof cte.compiled_path !== "string" ||
    typeof cte.compiled_start !== "number" ||
    typeof cte.compiled_stop !== "number"
  ) {
    return undefined;
  }
  return {
    name: cte.name,
    compiledPath: cte.compiled_path,
    compiledStart: cte.compiled_start,
    compiledStop: cte.compiled_stop,
    line,
  };
}

/** The compiled file no longer matches the lens that was rendered from it. */
class StaleCompiledFileError extends Error {
  constructor(name: string) {
    super(
      `The compiled file changed since the CTE "${name}" was listed; save the model and try again.`,
    );
    this.name = "StaleCompiledFileError";
  }
}

/**
 * `with` through the end of the CTE's body. The server's offsets count UTF-8 bytes, not UTF-16 units, so the file
 * is sliced as bytes. A slice that does not start with `with` or does not contain `<name> as (` was cut from a
 * different version of the file and is refused.
 */
function cteSlice(
  compiled: Buffer | string,
  cte: Pick<FusionCte, "name" | "compiledStart" | "compiledStop">,
): string {
  const bytes = typeof compiled === "string" ? Buffer.from(compiled) : compiled;
  const slice = bytes.subarray(cte.compiledStart, cte.compiledStop).toString();
  const escaped = cte.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(
    `["'\`\\[]?${escaped}["'\`\\]]?\\s+as\\s*\\(`,
    "i",
  );
  if (!/^\s*with\b/i.test(slice) || !declaration.test(slice)) {
    throw new StaleCompiledFileError(cte.name);
  }
  return slice;
}

function quoted(identifier: string): string {
  if (/^["'`[]/.test(identifier) || identifier.includes(".")) {
    return identifier;
  }
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)
    ? identifier
    : `"${identifier}"`;
}

/** The query that returns the CTE's rows. */
export function previewSql(compiled: Buffer | string, cte: FusionCte): string {
  return `${cteSlice(compiled, cte)}\n)\nselect * from ${quoted(cte.name)}`;
}

/** The query that counts the CTE's rows, with every earlier CTE of its WITH clause. */
export function countSql(compiled: Buffer | string, cte: FusionCte): string {
  return `${cteSlice(compiled, cte)}\n)\nselect count(*) as _profile_count from ${quoted(cte.name)}`;
}
