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
const NAMES_A_PACKAGE =
  /--workspace @fusion-power-user\/|--prefix \.\.\/packages\/|\b(build|watch):(contract|graph-layout)\b|\bbuild-(contract|graph-layout)\b/;

const BASELINE = new Set([
  "package.json vscode:prepublish",
  "package.json build:contract",
  "package.json build:graph-layout",
  "package.json watch:contract",
  "package.json build",
  "package.json build:dev",
  "package.json compile:integration",
  "webview_panels/package.json build:contract",
  "webview_panels/package.json build",
  "justfile build-contract",
  "justfile build",
  "justfile build-dev",
  "justfile watch",
  "justfile watch-extension",
  "webview_panels/justfile dev",
  "webview_panels/justfile watch",
  "webview_panels/justfile fmt",
  "webview_panels/justfile lint",
]);

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
      if (NAMES_A_PACKAGE.test(command)) {
        sites.push(`${file} ${name}`);
      }
    }
  }
  for (const file of ["justfile", "webview_panels/justfile"]) {
    for (const [name, body] of recipes(read(file))) {
      if (NAMES_A_PACKAGE.test(body)) {
        sites.push(`${file} ${name}`);
      }
    }
  }
  return sites;
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
  it.skipIf(scripts["build:packages"] === undefined)(
    "builds every package in build:packages",
    () => {
      const packages = readdirSync(join(ROOT, "packages"), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      expect(
        packages.filter(
          (dir) => !scripts["build:packages"]?.includes(`packages/${dir}`),
        ),
      ).toEqual([]);
    },
  );
});
