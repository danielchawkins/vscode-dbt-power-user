import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";
import eslintConfig from "../../../../eslint.config.mjs";
import hostOxlint from "../../../../oxlint.config";
import webviewEslintConfig from "../../../../webview_panels/eslint.config.mjs";
import webviewOxlint from "../../../../webview_panels/oxlint.config";

// Every path or glob that a repository config names must match a file in the checkout, so a moved or deleted
// directory fails here instead of leaving a rule that silently matches nothing.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Build and cache outputs that a clean checkout does not contain; a pattern under one of them may match nothing. */
const GENERATED =
  /^(?:\*\*\/)?(?:[\w*-]+\/)*(?:dist|out|coverage|node_modules|\.cache)(?:\/|$)/;

// A pattern whose last segment is `*.<ext>` names a file kind, not a path, so an empty match is not drift.
const KINDS = /^(?:[\w./-]+\/)?(?:\*\*\/)?\*\.[\w.{},]+$/;

const SKIP = new Set([
  "node_modules",
  ".jj",
  ".git",
  "dist",
  "out",
  "coverage",
  ".cache",
  ".vscode-test",
]);

interface Site {
  source: string;
  pattern: string;
}

/** Whether `pattern`, relative to the root, matches at least one file or directory in the working copy. */
function matches(pattern: string): boolean {
  const glob = join(pattern.replace(/^!/, "").replace(/!$/, ""));
  if (existsSync(join(ROOT, glob))) {
    return true;
  }
  const hits = globSync(glob, {
    cwd: ROOT,
    exclude: (name) => SKIP.has(basename(name)),
  });
  return hits.length > 0;
}

function exempt(pattern: string): boolean {
  const bare = pattern.replace(/^!/, "").replace(/!$/, "");
  return GENERATED.test(bare) || KINDS.test(bare);
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

function astGrepSites(): Site[] {
  const dir = join(ROOT, "ast-grep/rules");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".yml"))
    .flatMap((file) =>
      parseAllDocuments(readFileSync(join(dir, file), "utf8")).flatMap(
        (doc) => {
          const rule = doc.toJS() as {
            files?: string[];
            ignores?: string[];
          } | null;
          return [...(rule?.files ?? []), ...(rule?.ignores ?? [])].map(
            (pattern) => ({
              source: `ast-grep/rules/${file}`,
              pattern,
            }),
          );
        },
      ),
    );
}

function oxfmtSites(): Site[] {
  const config = JSON.parse(read(".oxfmtrc.json")) as {
    ignorePatterns: string[];
  };
  return config.ignorePatterns.map((pattern) => ({
    source: ".oxfmtrc.json",
    pattern,
  }));
}

function rumdlSites(): Site[] {
  const block =
    /exclude\s*=\s*\[([\s\S]*?)\]/.exec(read("rumdl.toml"))?.[1] ?? "";
  return Array.from(block.matchAll(/"([^"]+)"/g), (match) => ({
    source: "rumdl.toml",
    pattern: match[1] ?? "",
  }));
}

function lintIgnoreSites(): Site[] {
  const oxlint = (
    source: string,
    config: { ignorePatterns?: string[] },
    base: string,
  ) =>
    (config.ignorePatterns ?? []).map((pattern) => ({
      source,
      pattern: join(base, pattern),
    }));
  const eslint = (
    source: string,
    configs: { ignores?: string[] }[],
    base: string,
  ) =>
    configs.flatMap((config) =>
      (config.ignores ?? []).map((pattern) => ({
        source,
        pattern: join(base, pattern),
      })),
    );
  return [
    ...oxlint("oxlint.config.ts", hostOxlint, ""),
    ...oxlint(
      "webview_panels/oxlint.config.ts",
      webviewOxlint,
      "webview_panels",
    ),
    ...eslint("eslint.config.mjs", eslintConfig, ""),
    ...eslint(
      "webview_panels/eslint.config.mjs",
      webviewEslintConfig,
      "webview_panels",
    ),
  ];
}

function knipSites(): Site[] {
  const config = JSON.parse(read("knip.json")) as {
    workspaces: Record<
      string,
      { entry?: string[]; project?: string[]; ignore?: string[] }
    >;
  };
  return Object.entries(config.workspaces).flatMap(([dir, ws]) => [
    { source: "knip.json workspace", pattern: dir },
    ...[...(ws.entry ?? []), ...(ws.project ?? []), ...(ws.ignore ?? [])]
      .filter((pattern) => !pattern.startsWith("!"))
      .map((pattern) => ({
        source: `knip.json ${dir}`,
        pattern: join(dir, pattern),
      })),
  ]);
}

/** The sites whose pattern matches nothing and is not a generated output or a file kind. */
function staleSites(sites: Site[]): Site[] {
  return sites.filter(({ pattern }) => !exempt(pattern) && !matches(pattern));
}

describe("staleSites", () => {
  it("keeps a pattern that matches a file and drops one that matches nothing", () => {
    const sites = [
      { source: "probe", pattern: "src/**" },
      { source: "probe", pattern: "no_such_directory/**" },
      { source: "probe", pattern: "dist/webview" },
    ];
    expect(staleSites(sites)).toEqual([
      { source: "probe", pattern: "no_such_directory/**" },
    ]);
  });
});

describe("config paths", () => {
  it.each([
    ["ast-grep rule files and ignores", astGrepSites],
    ["oxfmt ignorePatterns", oxfmtSites],
    ["rumdl excludes", rumdlSites],
    ["Oxlint and ESLint ignores", lintIgnoreSites],
    ["knip workspaces and globs", knipSites],
  ])("every %s pattern names a path that exists", (_name, collect) => {
    const stale = staleSites(collect()).map(
      ({ source, pattern }) => `${source}: ${pattern}`,
    );
    expect(stale).toEqual([]);
  });
});
