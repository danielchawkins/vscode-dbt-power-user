import { describe, expect, it } from "vitest";
import { EventEmitter } from "vscode";
import { DocsEditViewPanel } from "../../features/docs/docsEditPanel";

/** The panel's column-sync path with its collaborators bypassed; only the spelling rule runs. */
function spelling(
  columns: { name: string }[],
  existing: string[],
): { name: string }[] {
  const panel = new DocsEditViewPanel(
    {
      onDidChangeManifest: new EventEmitter<unknown>().event,
      onDidRemoveProject: new EventEmitter<unknown>().event,
      get: () => undefined,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    { manifestFor: () => undefined } as never,
    { debug: () => undefined, info: () => undefined } as never,
  ) as unknown as {
    modifyColumnNames: (
      c: { name: string }[],
      e: string[],
    ) => { name: string }[];
  };
  return panel.modifyColumnNames(columns, existing);
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
