import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import hostConfig from "../../../../oxlint.config";
import webviewConfig from "../../../../webview_panels/oxlint.config";

// Oxlint must-fire fixtures (C5). Each fixture carries headers that say what it must trigger:
//   // lint-expect: <engine> <rule-id> [count]
//   // lint-expect-none: <engine|any> <rule-id>
// The Oxlint half runs here; the ESLint half and the cross-engine assertions arrive in P4b.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = join(ROOT, "test-fixtures/lint");
const OXLINT = join(ROOT, "node_modules/.bin/oxlint");
const execFileAsync = promisify(execFile);

type Engine = "oxlint" | "eslint" | "any";
interface Header {
  kind: "expect" | "none";
  engine: Engine;
  rule: string;
  count: number;
}
interface OxlintConfig {
  rules: Record<string, unknown>;
  overrides?: { rules?: Record<string, unknown> }[];
}
interface Workspace {
  name: string;
  dir: string;
  config: OxlintConfig;
  jsx: boolean;
}
interface Diagnostic {
  code: string;
  filename: string;
}
type Inventory = Record<
  string,
  Record<string, { engine: string; from: string }>
>;

const inventory = JSON.parse(
  readFileSync(join(FIXTURES, "inventory.json"), "utf8"),
) as Inventory;

const WORKSPACES: Workspace[] = [
  { name: "host", dir: ROOT, config: hostConfig, jsx: false },
  {
    name: "webview",
    dir: join(ROOT, "webview_panels"),
    config: webviewConfig,
    jsx: true,
  },
];

const HEADER =
  /^\/\/ lint-expect(-none)?: (oxlint|eslint|any) (\S+)(?: (\d+))?$/;

function parseHeaders(text: string): Header[] {
  return text.split("\n").flatMap((line) => {
    const match = HEADER.exec(line.trim());
    if (!match) {
      return [];
    }
    return [
      {
        kind: match[1] ? "none" : "expect",
        engine: (match[2] ?? "any") as Engine,
        rule: match[3] ?? "",
        count: Number(match[4] ?? 1),
      },
    ];
  });
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

// Oxlint names a rule as plugin(rule); the inventory keys plugins as plugin/rule, with
// jsx-a11y written jsx_a11y. These three Oxlint names differ from the inventory keys.
const OXLINT_NAME_TO_KEY: Record<string, string> = {
  "react-hooks/rules-of-hooks": "react/rules-of-hooks",
  "react-hooks/exhaustive-deps": "react/exhaustive-deps",
  "react/void-use-memo": "react/use-memo",
};

// Oxlint 1.87 reports nothing for these rules on any input tried, so their fixtures can't fire.
// The test fails if one starts firing, so the entry is removed with the fix.
const KNOWN_SILENT: Record<string, string> = {
  "jsx_a11y/autocomplete-valid": "Oxlint 1.87 never reports autocomplete-valid",
};

function inventoryKey(code: string): string | undefined {
  const match = /^([\w-]+)\((.+)\)$/.exec(code);
  if (!match) {
    return undefined;
  }
  const oxlintName = `${match[1] ?? ""}/${match[2] ?? ""}`;
  return (
    OXLINT_NAME_TO_KEY[oxlintName] ??
    `${(match[1] ?? "").replace(/-/g, "_")}/${match[2] ?? ""}`
  );
}

// Runs the pinned Oxlint on the fixtures copied into .cache/lint-fixtures/<workspace>/, next to
// the generated config and tsconfig. Passing paths explicitly keeps Oxlint from skipping the
// gitignored .cache directory (Q18).
async function lintFixtures(
  ws: Workspace,
  files: string[],
): Promise<Map<string, Map<string, number>>> {
  const fixtureRoot = join(FIXTURES, ws.name);
  const work = join(ws.dir, ".cache", "lint-fixtures", ws.name);
  await rm(work, { recursive: true, force: true });
  const rels = files.map((file) =>
    relative(fixtureRoot, file).split(sep).join("/"),
  );
  for (const rel of rels) {
    const dest = join(work, rel);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(join(fixtureRoot, rel), dest);
  }
  await writeFile(
    join(work, ".oxlintrc.json"),
    JSON.stringify(ws.config, null, 2),
  );
  const tsconfig = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "ES2024",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2024", "DOM"],
      jsx: ws.jsx ? "react-jsx" : undefined,
      skipLibCheck: true,
    },
    include: ["src/**/*"],
  };
  await writeFile(
    join(work, "tsconfig.json"),
    JSON.stringify(tsconfig, null, 2),
  );

  const args = [
    "--type-aware",
    "--format",
    "json",
    "-c",
    ".oxlintrc.json",
    ...rels,
  ];
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(OXLINT, args, {
      cwd: work,
      timeout: 200_000,
      maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    // Oxlint exits 1 when it reports diagnostics; the JSON is still on stdout.
    const failed = error as { stdout?: string };
    if (!failed.stdout) {
      throw error;
    }
    stdout = failed.stdout;
  }
  const report = JSON.parse(stdout) as { diagnostics: Diagnostic[] };

  const reported = new Map<string, Map<string, number>>();
  for (const diagnostic of report.diagnostics) {
    const key = inventoryKey(diagnostic.code);
    if (!key) {
      continue;
    }
    const file = diagnostic.filename.split(sep).join("/").replace(/^\.\//, "");
    const counts = reported.get(file) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    reported.set(file, counts);
  }
  return reported;
}

// The failures one header adds, given how many times Oxlint reported its rule on the fixture.
function headerFailures(
  ws: Workspace,
  rel: string,
  header: Header,
  count: number,
): string[] {
  if (header.kind === "none") {
    return count > 0
      ? [`${rel}: ${header.rule} must not be reported, got ${count}`]
      : [];
  }
  if (
    inventory[ws.name]?.[header.rule]?.engine !== "oxlint" &&
    header.engine === "oxlint"
  ) {
    return [`${rel}: ${header.rule} is not an oxlint entry in the inventory`];
  }
  if (KNOWN_SILENT[header.rule] !== undefined) {
    return count > 0
      ? [`${rel}: ${header.rule} now fires; remove it from KNOWN_SILENT`]
      : [];
  }
  return count < header.count
    ? [
        `${rel}: expected ${header.rule} at least ${header.count}x, got ${count}`,
      ]
    : [];
}

function fixtureFailures(
  ws: Workspace,
  files: string[],
  reported: Map<string, Map<string, number>>,
): string[] {
  const failures: string[] = [];
  for (const file of files) {
    const rel = relative(join(FIXTURES, ws.name), file).split(sep).join("/");
    // ESLint headers belong to P4b; this check covers the Oxlint half.
    const headers = parseHeaders(readFileSync(file, "utf8")).filter(
      (h) => h.engine !== "eslint",
    );
    if (headers.length === 0) {
      failures.push(`${rel}: no oxlint lint-expect or lint-expect-none header`);
    }
    for (const header of headers) {
      failures.push(
        ...headerFailures(
          ws,
          rel,
          header,
          reported.get(rel)?.get(header.rule) ?? 0,
        ),
      );
    }
  }
  return failures;
}

describe("Oxlint must-fire fixtures", () => {
  for (const ws of WORKSPACES) {
    it(`${ws.name}: every lint-expect header is reported, and no lint-expect-none rule is`, async () => {
      const files = (await listFiles(join(FIXTURES, ws.name))).filter((file) =>
        /\.(tsx?|js)$/.test(file),
      );
      const reported = await lintFixtures(ws, files);
      expect(fixtureFailures(ws, files, reported)).toEqual([]);
    }, 240_000);

    // Completeness: each oxlint inventory entry has a lint-expect that fires (above), so
    // enablement is covered by the fire check, not by reading the config.
    it(`${ws.name}: the oxlint inventory and the oxlint lint-expect headers name the same rules`, async () => {
      const files = (await listFiles(join(FIXTURES, ws.name))).filter((file) =>
        /\.(tsx?|js)$/.test(file),
      );
      const inventoried = Object.entries(inventory[ws.name] ?? {})
        .filter(([, entry]) => entry.engine === "oxlint")
        .map(([rule]) => rule);
      const expected = files
        .flatMap((file) => parseHeaders(readFileSync(file, "utf8")))
        .filter(
          (header) => header.kind === "expect" && header.engine === "oxlint",
        )
        .map((header) => header.rule);
      const missing = inventoried.filter((rule) => !expected.includes(rule));
      const unknown = [...new Set(expected)].filter(
        (rule) => !inventoried.includes(rule),
      );
      expect({ missing, unknown }).toEqual({ missing: [], unknown: [] });
    });
  }
});
