import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { convertColumnNamesByCaseConfig } from "../../features/docs/docsYaml";

const root = mkdtempSync(join(tmpdir(), "col-spelling-"));
afterAll(() => rmSync(root, { recursive: true }));

/** The YAML spelling applied to `columns` for a model whose schema file lists `existing`. */
function spelling(columns: { name: string }[], existing: string[]) {
  const body = existing.map((name) => `      - name: ${name}`).join("\n");
  writeFileSync(
    join(root, "schema.yml"),
    `models:\n  - name: m\n    columns:\n${body || "      []"}\n`,
  );
  return convertColumnNamesByCaseConfig(columns, "m", "schema.yml", root);
}

describe("column spelling when syncing from the server", () => {
  it("keeps the YAML spelling of a column the server spells differently", () => {
    expect(spelling([{ name: "ORDER_ID" }], ["Order_ID"])).toEqual([
      { name: "Order_ID" },
    ]);
  });

  it("takes the server's spelling only for a column new to the YAML", () => {
    expect(
      spelling([{ name: "ORDER_ID" }, { name: "TOTAL" }], ["Order_ID"]),
    ).toEqual([{ name: "Order_ID" }, { name: "TOTAL" }]);
  });

  it("leaves an empty YAML untouched", () => {
    expect(spelling([{ name: "ID" }], [])).toEqual([{ name: "ID" }]);
  });
});
