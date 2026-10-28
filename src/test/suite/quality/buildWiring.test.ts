import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Workspace packages (packages/*) are built in one place: the root `build:packages` and `watch:packages` scripts,
// which every build, watch, lint and test entrypoint calls. An entrypoint that names one package itself
// (`build:contract`, `--workspace @fusion-power-user/…`, `--prefix ../packages/…`) has to be edited for every new
// package and every new consumer, and drifts: `npm run build` builds graph-layout while `just build` does not.
// BASELINE lists the entrypoints that still name a package. Entries only leave it: the second test fails on a
// stale entry, so the list shrinks.

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const PACKAGE_DIRS = readdirSync(join(ROOT, "packages"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// The two scripts that name every package on purpose.
const ALLOWED = new Set([
  "package.json build:packages",
  "package.json watch:packages",
]);

const BASELINE = new Set<string>();

/**
 * Whether a command names a workspace package in `dirs`: its `@fusion-power-user/` name, its `packages/<dir>` path,
 * a `build` or `watch` script for it, or a `-w` / `--workspace` argument that names it.
 */
function namesAPackage(command: string, dirs: string[]): boolean {
  const names = dirs.join("|");
  const pattern = new RegExp(
    [
      "@fusion-power-user/",
      `packages/(?:${names})\\b`,
      `\\b(?:build|watch)[:-](?:${names})\\b`,
      `(?:-w|--workspace)(?:=|\\s+)\\S*(?:${names})\\b`,
    ].join("|"),
  );
  return pattern.test(command);
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Each recipe of a justfile with its body: the indented lines below its header. */
function recipes(justfile: string): Map<string, string> {
  const bodies = new Map<string, string>();
  let current: string | undefined;
  for (const line of justfile.split("\n")) {
    const header = /^([a-z][\w-]*)(?:\s[^:=]*)?:(?!=)/.exec(line);
    if (header) {
      current = header[1];
      bodies.set(current, "");
    } else if (current && /^\s/.test(line)) {
      bodies.set(current, `${bodies.get(current)}${line.trim()}\n`);
    } else if (line.trim() !== "") {
      current = undefined;
    }
  }
  return bodies;
}

/** `"<file> <entrypoint>"` for each npm script and Just recipe whose command names one workspace package. */
function packageNamingSites(): string[] {
  const sites: string[] = [];
  for (const file of ["package.json", "webview_panels/package.json"]) {
    const scripts = (
      JSON.parse(read(file)) as { scripts: Record<string, string> }
    ).scripts;
    for (const [name, command] of Object.entries(scripts)) {
      if (namesAPackage(command, PACKAGE_DIRS)) {
        sites.push(`${file} ${name}`);
      }
    }
  }
  for (const file of ["justfile", "webview_panels/justfile"]) {
    for (const [name, body] of recipes(read(file))) {
      if (namesAPackage(body, PACKAGE_DIRS)) {
        sites.push(`${file} ${name}`);
      }
    }
  }
  return sites.filter((site) => !ALLOWED.has(site));
}

describe("recipes", () => {
  it("returns each recipe's indented body and skips assignments", () => {
    const justfile = 'x := "1"\na:\n    one\n\n    two\nb *args:\n    three\n';
    expect([...recipes(justfile)]).toEqual([
      ["a", "one\ntwo\n"],
      ["b", "three\n"],
    ]);
  });
});

describe("namesAPackage", () => {
  const dirs = ["graph-layout", "webview-contract", "third"];

  it.each([
    "npm run build -w @fusion-power-user/graph-layout",
    "npm run build --workspace=@fusion-power-user/graph-layout",
    "npm run build --workspace packages/graph-layout",
    "node node_modules/typescript-7/bin/tsc -b packages/graph-layout",
    "npm run watch --prefix packages/webview-contract",
    "npm run build:third",
    "npm run build-third",
    "npm run build --prefix ../packages/webview-contract",
  ])("flags %s", (command) => {
    expect(namesAPackage(command, dirs)).toBe(true);
  });

  it.each([
    "npm run build:packages --prefix ..",
    "npm run build:app --workspace webview_panels",
    "npm run watch:extension:app",
    "node node_modules/typescript-7/bin/tsc -p tsconfig.integration.json",
    "eslint src scripts packages",
    "depcruise src packages/*/src --config .dependency-cruiser.cjs",
    "npm run watch --watch",
  ])("passes %s", (command) => {
    expect(namesAPackage(command, dirs)).toBe(false);
  });
});

describe("build wiring", () => {
  const sites = new Set(packageNamingSites());

  it("names a workspace package only in the baseline", () => {
    expect([...sites].filter((site) => !BASELINE.has(site))).toEqual([]);
  });

  it("keeps no baseline entry the scripts no longer have", () => {
    expect([...BASELINE].filter((site) => !sites.has(site))).toEqual([]);
  });

  const scripts = (
    JSON.parse(read("package.json")) as { scripts: Record<string, string> }
  ).scripts;
  it.each(["build:packages", "watch:packages"])(
    "builds every package in %s",
    (name) => {
      expect(scripts[name]).toBeDefined();
      expect(
        PACKAGE_DIRS.filter(
          (dir) => !scripts[name]?.includes(`packages/${dir}`),
        ),
      ).toEqual([]);
    },
  );

  it("watches exactly what build:packages builds", () => {
    expect(scripts["watch:packages"]).toBe(
      `${scripts["build:packages"]} --watch --preserveWatchOutput`,
    );
  });
});
