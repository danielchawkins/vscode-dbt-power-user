import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { fieldsOwnedBy } from "../../core/metadata";
import { esmDirname } from "../esmDirname";

const gaps = fs.readFileSync(
  path.resolve(
    esmDirname(import.meta.url),
    "../../../docs/lsp-metadata-gaps.md",
  ),
  "utf8",
);
const rows = gaps.split("\n").filter((line) => line.startsWith("| "));
const mapColumn = rows.map((row) => row.split("|")[2] ?? "").join("\n");

describe("FIELD_OWNERS and docs/lsp-metadata-gaps.md", () => {
  it("has a row for every parse-owned key", () => {
    for (const field of fieldsOwnedBy("parse")) {
      expect(mapColumn, field).toContain(field);
    }
  });

  it("names no server-owned key in the manifest map column, except the constraint overlay", () => {
    // Constraint edges are the one parse-owned overlay on a server-owned map.
    const overlay = new Set(["graphMetaMap.parents", "graphMetaMap.children"]);
    for (const field of fieldsOwnedBy("server")) {
      if (!overlay.has(field)) {
        expect(mapColumn, field).not.toContain(`\`${field}\``);
      }
    }
  });
});
