import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const srcRoot = path.join(repositoryRoot, "src");
const webviewPanelsSrcRoot = path.join(repositoryRoot, "webview_panels", "src");
const packageJsonPath = path.join(repositoryRoot, "package.json");

/** Extension-owned command, view, context, and submenu IDs use fusionPowerUser.* */
const LEGACY_NAMESPACE_PATTERN = /dbtPowerUser\./;

function listProductionSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "test") {
        continue;
      }
      files.push(...listProductionSourceFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

function findLegacyNamespaceHits(
  relativePath: string,
  contents: string,
): string[] {
  const hits: string[] = [];
  for (const [lineNumber, line] of contents.split("\n").entries()) {
    if (LEGACY_NAMESPACE_PATTERN.test(line)) {
      hits.push(`${relativePath}:${lineNumber + 1}: ${line.trim()}`);
    }
  }
  return hits;
}

describe("fusionPowerUser namespace guard", () => {
  it("has no legacy dbtPowerUser.* IDs in package.json", () => {
    const contents = readFileSync(packageJsonPath, "utf8");
    expect(findLegacyNamespaceHits("package.json", contents)).toEqual([]);
  });

  it("has no legacy dbtPowerUser.* IDs in production source", () => {
    const hits: string[] = [];
    for (const filePath of listProductionSourceFiles(srcRoot)) {
      const relativePath = path.relative(repositoryRoot, filePath);
      const contents = readFileSync(filePath, "utf8");
      hits.push(...findLegacyNamespaceHits(relativePath, contents));
    }
    expect(hits).toEqual([]);
  });

  it("has no legacy dbtPowerUser.* IDs in webview panel source", () => {
    const hits: string[] = [];
    for (const filePath of listProductionSourceFiles(webviewPanelsSrcRoot)) {
      const relativePath = path.relative(repositoryRoot, filePath);
      const contents = readFileSync(filePath, "utf8");
      hits.push(...findLegacyNamespaceHits(relativePath, contents));
    }
    expect(hits).toEqual([]);
  });
});
