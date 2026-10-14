import { ESLint } from "eslint";
import oxlint from "eslint-plugin-oxlint";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import eslintConfig from "../../../../eslint.config.mjs";
import { HELD_RULES } from "../../../../lint/held-rules.mjs";
import hostConfig from "../../../../oxlint.config";
import webviewEslintConfig from "../../../../webview_panels/eslint.config.mjs";
import webviewConfig from "../../../../webview_panels/oxlint.config";

// Must-fire fixtures (C5). Each fixture carries headers that say what it must trigger:
//   // lint-expect: <engine> <rule-id> [count]
//   // lint-expect-none: <engine|any> <rule-id>
// Each engine checks its own headers, and `any` headers are checked by both.

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

// Shape of a resolved ESLint config, as calculateConfigForFile returns it.
interface ResolvedEslint {
  rules: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  languageOptions?: { parserOptions?: Record<string, unknown> };
}

// The fixture that cannot reach its ESLint rule: module code is strict, so the parser rejects the
// octal literal before any rule runs. The inventory still lists the rule.
const UNREACHABLE_ESLINT: Record<string, string> = {
  "no-octal": "the parser rejects octal literals in module code",
};

function ruleOn(value: unknown): boolean {
  const severity = Array.isArray(value) ? value[0] : value;
  return severity !== undefined && severity !== "off" && severity !== 0;
}

async function fixtureFiles(ws: Workspace): Promise<string[]> {
  return (await listFiles(join(FIXTURES, ws.name))).filter((file) =>
    /\.(tsx?|js)$/.test(file),
  );
}

async function fixtureHeaders(
  ws: Workspace,
): Promise<{ rel: string; header: Header }[]> {
  const root = join(FIXTURES, ws.name);
  return (await fixtureFiles(ws)).flatMap((file) => {
    const rel = relative(root, file).split(sep).join("/");
    return parseHeaders(readFileSync(file, "utf8")).map((header) => ({
      rel,
      header,
    }));
  });
}

// Lints each fixture under its mirrored path, so the ESLint config that applies is the one resolved.
async function lintWithEslint(
  ws: Workspace,
  files: string[],
): Promise<Map<string, Map<string, number>>> {
  const eslint = new ESLint({ cwd: ws.dir });
  const reported = new Map<string, Map<string, number>>();
  for (const file of files) {
    const rel = relative(join(FIXTURES, ws.name), file).split(sep).join("/");
    const [result] = await eslint.lintText(readFileSync(file, "utf8"), {
      filePath: join(ws.dir, rel),
    });
    const counts = new Map<string, number>();
    for (const message of result.messages) {
      if (message.ruleId) {
        counts.set(message.ruleId, (counts.get(message.ruleId) ?? 0) + 1);
      }
    }
    reported.set(rel, counts);
  }
  return reported;
}

const resolvedCache = new Map<string, Promise<Map<string, ResolvedEslint>>>();

// The resolved ESLint config for every fixture path in a workspace, computed once per run.
function resolvedEslint(ws: Workspace): Promise<Map<string, ResolvedEslint>> {
  let cached = resolvedCache.get(ws.name);
  if (cached === undefined) {
    cached = (async () => {
      const eslint = new ESLint({ cwd: ws.dir });
      const resolved = new Map<string, ResolvedEslint>();
      for (const file of await fixtureFiles(ws)) {
        const rel = relative(join(FIXTURES, ws.name), file)
          .split(sep)
          .join("/");
        resolved.set(
          rel,
          (await eslint.calculateConfigForFile(
            join(ws.dir, rel),
          )) as ResolvedEslint,
        );
      }
      return resolved;
    })();
    resolvedCache.set(ws.name, cached);
  }
  return cached;
}

// Type-aware parser options, and rules whose metadata says they need type information (D10).
// naming-convention is marked so, but with the webview's options (no `types` modifiers) it loads and
// reports untyped; architecture 10 records that as checked on 2026-10-09, so it is the one exception.
const UNTYPED_BY_CHECK: Record<string, string> = {
  "@typescript-eslint/naming-convention":
    "webview options use no types modifiers (checked 2026-10-09)",
};

function requiresTypeChecking(config: ResolvedEslint, id: string): boolean {
  const slash = id.lastIndexOf("/");
  if (slash < 0 || UNTYPED_BY_CHECK[id] !== undefined) {
    return false;
  }
  const plugin = config.plugins?.[id.slice(0, slash)] as
    | {
        rules?: Record<
          string,
          { meta?: { docs?: { requiresTypeChecking?: boolean } } }
        >;
      }
    | undefined;
  return (
    plugin?.rules?.[id.slice(slash + 1)]?.meta?.docs?.requiresTypeChecking ===
    true
  );
}

function typeFailures(rel: string, config: ResolvedEslint): string[] {
  const parserOptions = config.languageOptions?.parserOptions ?? {};
  const failures = ["project", "projectService"]
    .filter((key) => parserOptions[key] !== undefined)
    .map((key) => `${rel}: parserOptions.${key} makes ESLint type-aware`);
  for (const [id, value] of Object.entries(config.rules)) {
    if (ruleOn(value) && requiresTypeChecking(config, id)) {
      failures.push(`${rel}: ${id} needs type information`);
    }
  }
  return failures;
}

// The failures one header adds, given how many times Oxlint reported its rule on the fixture.
function headerFailures(
  ws: Workspace,
  fixture: { rel: string; header: Header },
  count: number,
): string[] {
  const { rel, header } = fixture;
  if (header.kind === "none") {
    return count > 0
      ? [`${rel}: ${header.rule} must not be reported, got ${count}`]
      : [];
  }
  if (
    header.engine !== "any" &&
    inventory[ws.name]?.[header.rule]?.engine !== header.engine
  ) {
    return [
      `${rel}: ${header.rule} is not a ${header.engine} entry in the inventory`,
    ];
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
  scope: { ws: Workspace; engine: "oxlint" | "eslint" },
  files: string[],
  reported: Map<string, Map<string, number>>,
): string[] {
  const { ws, engine } = scope;
  const failures: string[] = [];
  for (const file of files) {
    const rel = relative(join(FIXTURES, ws.name), file).split(sep).join("/");
    const all = parseHeaders(readFileSync(file, "utf8"));
    if (engine === "oxlint" && all.length === 0) {
      failures.push(`${rel}: no lint-expect or lint-expect-none header`);
    }
    const headers = all.filter(
      (h) => h.engine === engine || h.engine === "any",
    );
    for (const header of headers) {
      failures.push(
        ...headerFailures(
          ws,
          { rel, header },
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
      expect(
        fixtureFailures({ ws, engine: "oxlint" }, files, reported),
      ).toEqual([]);
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

// Held typed rules (D11): configured in neither engine, so each one's fixture must stay silent.
interface HeldRule {
  severity: string;
  options: readonly unknown[];
  needs: string;
  watchFor: readonly string[];
  unblock: string;
}

function isEnabled(config: OxlintConfig, id: string): boolean {
  const values = [
    config.rules,
    ...(config.overrides ?? []).map((o) => o.rules ?? {}),
  ];
  return values.some((rules) => rules[id] !== undefined && rules[id] !== "off");
}

// `oxlint --rules` prints a markdown table: | rule | source | ... ; the source is the plugin name.
async function oxlintRuleIds(): Promise<Set<string>> {
  const { stdout } = await execFileAsync(OXLINT, ["--rules"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  return new Set(
    stdout.split("\n").flatMap((line) => {
      const [, rule = "", source = ""] = line
        .split("|")
        .map((cell) => cell.trim());
      return rule && source ? [`${source}/${rule}`] : [];
    }),
  );
}

describe("held typed rules (D11)", () => {
  for (const ws of WORKSPACES) {
    const held = HELD_RULES[ws.name as keyof typeof HELD_RULES] as Record<
      string,
      HeldRule
    >;
    const heldInventory = Object.keys(inventory[ws.name] ?? {}).filter(
      (rule) => inventory[ws.name]?.[rule]?.engine === "held",
    );

    it(`${ws.name}: the held inventory entries and HELD_RULES name the same rules`, () => {
      expect(heldInventory.sort()).toEqual(Object.keys(held).sort());
    });

    it(`${ws.name}: every held rule has a non-empty unblock and watchFor`, () => {
      const failures = Object.entries(held).flatMap(([rule, entry]) => [
        ...(entry.unblock ? [] : [`${rule}: empty unblock`]),
        ...(entry.watchFor.length > 0 ? [] : [`${rule}: empty watchFor`]),
      ]);
      expect(failures).toEqual([]);
    });

    it(`${ws.name}: no held rule is enabled in the oxlint config under its from or watchFor id`, () => {
      const enabled = Object.entries(held).flatMap(([rule, entry]) =>
        [rule, ...entry.watchFor].filter((id) => isEnabled(ws.config, id)),
      );
      expect(enabled).toEqual([]);
    });

    it(`${ws.name}: no held rule's watchFor id is in the pinned oxlint --rules`, async () => {
      const ids = await oxlintRuleIds();
      const native = Object.values(held).flatMap((entry) =>
        entry.watchFor.filter((id) => ids.has(id)),
      );
      expect(native).toEqual([]);
    });
  }
});

describe("ESLint must-fire fixtures", () => {
  for (const ws of WORKSPACES) {
    it(`${ws.name}: every lint-expect eslint header is reported, and no lint-expect-none rule is`, async () => {
      const files = await fixtureFiles(ws);
      const reported = await lintWithEslint(ws, files);
      expect(
        fixtureFailures({ ws, engine: "eslint" }, files, reported),
      ).toEqual([]);
    }, 120_000);
  }
});

describe("lint rules by engine (D10, D11)", () => {
  for (const ws of WORKSPACES) {
    const entries = Object.entries(inventory[ws.name] ?? {});

    it(`${ws.name}: every inventory entry has a lint-expect from its own engine`, async () => {
      const expects = (await fixtureHeaders(ws)).filter(
        ({ header }) => header.kind === "expect",
      );
      const missing = entries
        .filter(
          ([rule, entry]) =>
            entry.engine !== "held" &&
            UNREACHABLE_ESLINT[rule] === undefined &&
            !expects.some(
              ({ header }) =>
                header.rule === rule && header.engine === entry.engine,
            ),
        )
        .map(([rule]) => rule);
      expect(missing).toEqual([]);
    });

    it(`${ws.name}: every held entry has a lint-expect-none any fixture`, async () => {
      const none = (await fixtureHeaders(ws)).filter(
        ({ header }) => header.kind === "none" && header.engine === "any",
      );
      const missing = entries
        .filter(([, entry]) => entry.engine === "held")
        .filter(([rule]) => !none.some(({ header }) => header.rule === rule))
        .map(([rule]) => rule);
      expect(missing).toEqual([]);
    });

    it(`${ws.name}: every eslint entry is enabled in the config its fixture resolves to`, async () => {
      const headers = await fixtureHeaders(ws);
      const resolved = await resolvedEslint(ws);
      const failures = entries.flatMap(([rule, entry]) => {
        const fixture = headers.find(
          ({ header }) =>
            header.kind === "expect" &&
            header.engine === "eslint" &&
            header.rule === rule,
        );
        if (entry.engine !== "eslint" || fixture === undefined) {
          return [];
        }
        const config = resolved.get(fixture.rel);
        return ruleOn(config?.rules[entry.from])
          ? []
          : [`${fixture.rel}: ${entry.from} is off`];
      });
      expect(failures).toEqual([]);
    });

    it(`${ws.name}: no ESLint rule is enabled without an eslint inventory entry`, async () => {
      const eslintIds = new Set(
        entries
          .filter(([, entry]) => entry.engine === "eslint")
          .map(([, entry]) => entry.from),
      );
      const failures = [...(await resolvedEslint(ws))].flatMap(
        ([rel, config]) =>
          Object.entries(config.rules)
            .filter(([id, value]) => ruleOn(value) && !eslintIds.has(id))
            .map(([id]) => `${rel}: ${id} is enabled with no eslint entry`),
      );
      expect(failures).toEqual([]);
    });

    it(`${ws.name}: held rules are enabled in no resolved ESLint config`, async () => {
      const held = Object.entries(
        HELD_RULES[ws.name as keyof typeof HELD_RULES] as Record<
          string,
          HeldRule
        >,
      );
      const ids = held.flatMap(([rule, entry]) => [rule, ...entry.watchFor]);
      const configs = [...(await resolvedEslint(ws)).values()];
      const enabled = ids.filter((id) =>
        configs.some((config) => ruleOn(config.rules[id])),
      );
      expect(enabled).toEqual([]);
    });

    it(`${ws.name}: no resolved ESLint config is type-aware (D10)`, async () => {
      const failures = [...(await resolvedEslint(ws))].flatMap(
        ([rel, config]) => typeFailures(rel, config),
      );
      expect(failures).toEqual([]);
    });

    it(`${ws.name}: the untyped check flags type-aware options and typed rules`, async () => {
      const base = [...(await resolvedEslint(ws)).values()][0];
      const withProject = {
        ...base,
        languageOptions: { parserOptions: { project: "./tsconfig.json" } },
      };
      const withService = {
        ...base,
        languageOptions: { parserOptions: { projectService: true } },
      };
      const withRule = {
        ...base,
        plugins: { ...base.plugins, "@typescript-eslint": tseslint.plugin },
        rules: { ...base.rules, "@typescript-eslint/await-thenable": "error" },
      };
      expect(typeFailures("probe", withProject)).toEqual([
        "probe: parserOptions.project makes ESLint type-aware",
      ]);
      expect(typeFailures("probe", withService)).toEqual([
        "probe: parserOptions.projectService makes ESLint type-aware",
      ]);
      expect(typeFailures("probe", withRule)).toEqual([
        "probe: @typescript-eslint/await-thenable needs type information",
      ]);
    });
  }
});

describe("ESLint runs after oxlint's flat/all (O10)", () => {
  const flatAll = oxlint.configs["flat/all"] as unknown[];
  const turnedOff = flatAll.flatMap((config) =>
    Object.entries((config as { rules?: Record<string, unknown> }).rules ?? {})
      .filter(([, value]) => !ruleOn(value))
      .map(([id]) => id),
  );
  const configs = [
    ["host", eslintConfig],
    ["webview", webviewEslintConfig],
  ] as const;

  for (const [name, config] of configs) {
    it(`${name}: the config ends with oxlint's flat/all, unchanged`, () => {
      expect((config as unknown[]).slice(-flatAll.length)).toEqual(flatAll);
    });

    // flat/all turns some rules off, so the resolved config would hide an enable placed before it.
    it(`${name}: no rule with an oxlint home is enabled by any ESLint config entry`, () => {
      const oxlintIds = new Set(
        Object.values(inventory[name] ?? {})
          .filter((entry) => entry.engine === "oxlint")
          .map((entry) => entry.from),
      );
      const enabled = (config as { rules?: Record<string, unknown> }[]).flatMap(
        (entry) =>
          Object.entries(entry.rules ?? {})
            .filter(([id, value]) => oxlintIds.has(id) && ruleOn(value))
            .map(([id]) => id),
      );
      expect(enabled).toEqual([]);
    });
  }

  for (const ws of WORKSPACES) {
    it(`${ws.name}: no fixture path enables a rule that flat/all turns off`, async () => {
      const failures = [...(await resolvedEslint(ws))].flatMap(
        ([rel, config]) =>
          turnedOff
            .filter((id) => ruleOn(config.rules[id]))
            .map((id) => `${rel}: ${id} is enabled after flat/all`),
      );
      expect(failures).toEqual([]);
    });
  }
});

describe("ESLint stays untyped (D10)", () => {
  // The real config plus a typed rule. typescript-eslint's await-thenable calls getParserServices,
  // so linting any fixture without a project must throw.
  for (const ws of WORKSPACES) {
    it(`${ws.name}: a real-config lint with a typed rule throws without type information`, async () => {
      const eslint = new ESLint({
        cwd: ws.dir,
        overrideConfig: {
          plugins: { "@typescript-eslint": tseslint.plugin },
          rules: { "@typescript-eslint/await-thenable": "error" },
        },
      });
      const [file] = await fixtureFiles(ws);
      const rel = relative(join(FIXTURES, ws.name), file).split(sep).join("/");
      await expect(
        eslint.lintText(readFileSync(file, "utf8"), {
          filePath: join(ws.dir, rel),
        }),
      ).rejects.toThrow(/requires type information/);
    });
  }
});
