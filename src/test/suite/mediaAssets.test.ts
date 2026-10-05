import { globSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { esmDirname } from "../esmDirname";

const repositoryRoot = path.resolve(esmDirname(import.meta.url), "../../..");
const mediaDirectory = path.join(repositoryRoot, "media", "images");

function referencedMediaFiles(): string[] {
  const files = [
    "package.json",
    ...globSync(
      ["src/**/*.{ts,tsx,js}", "webview_panels/src/**/*.{ts,tsx,js}"],
      { cwd: repositoryRoot },
    ).filter((file) => !file.startsWith(`src${path.sep}test${path.sep}`)),
  ];
  const references = new Set<string>();
  const mediaPath = /media\/images\/([A-Za-z0-9._-]+)/g;

  for (const file of files) {
    const contents = readFileSync(path.join(repositoryRoot, file), "utf8");
    for (const match of contents.matchAll(mediaPath)) {
      references.add(match[1]);
    }
  }

  return [...references].sort();
}

describe("packaged media assets", () => {
  it("contains exactly the images referenced by the manifest and runtime", () => {
    const packagedFiles = readdirSync(mediaDirectory)
      .filter((entry) => !entry.startsWith("."))
      .sort();

    expect(packagedFiles).toEqual(referencedMediaFiles());
  });
});
