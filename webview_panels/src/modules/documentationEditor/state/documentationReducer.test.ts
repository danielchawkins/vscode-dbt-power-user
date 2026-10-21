import type { columnProposals } from "@fusion-power-user/webview-contract";
import { describe, expect, it } from "vitest";
import type { ProposalChoices } from "../proposals/proposalsReducer";
import { isStateDirty } from "../utils";
import {
  applyColumnProposals,
  documentationReducer,
  initialState,
  setDocBlocks,
  setIncomingDocsData,
  setProject,
  updateColumnsInCurrentDocsData,
  updateCurrentDocsData,
} from "./documentationReducer";
import type { DBTDocumentation } from "./types";
import { Source } from "./types";

const docs = (description: string, name = "orders"): DBTDocumentation => ({
  name,
  description,
  columns: [
    {
      name: "id",
      description: "key",
      generated: false,
      source: Source.YAML,
    },
  ],
  generated: false,
  filePath: `/models/${name}.sql`,
  uniqueId: `model.p.${name}`,
});

const loaded = documentationReducer(
  initialState,
  setIncomingDocsData({ docs: docs("first") }),
);

describe("documentationReducer", () => {
  it("takes incoming documentation on first load", () => {
    expect(loaded.currentDocsData?.description).toBe("first");
    expect(loaded.incomingDocsData?.docs?.description).toBe("first");
  });

  it("keeps unsaved edits when new documentation arrives", () => {
    const edited = documentationReducer(
      loaded,
      updateCurrentDocsData({ name: "orders", description: "edited" }),
    );
    const next = documentationReducer(
      edited,
      setIncomingDocsData({ docs: docs("second") }),
    );
    expect(next.currentDocsData?.description).toBe("edited");
    expect(next.incomingDocsData?.docs?.description).toBe("second");
  });

  it("replaces clean documentation when new documentation arrives", () => {
    const next = documentationReducer(
      loaded,
      setIncomingDocsData({ docs: docs("second") }),
    );
    expect(next.currentDocsData?.description).toBe("second");
  });

  it("clears current documentation for an empty payload and ignores nameless ones", () => {
    expect(
      documentationReducer(loaded, updateCurrentDocsData({})).currentDocsData,
    ).toBeUndefined();
    expect(
      documentationReducer(loaded, updateCurrentDocsData({ description: "x" })),
    ).toBe(loaded);
  });

  it("replaces documentation when the model changes", () => {
    const other = docs("other", "customers");
    expect(
      documentationReducer(loaded, updateCurrentDocsData(other))
        .currentDocsData,
    ).toEqual(other);
  });

  it("updates matching columns only", () => {
    const next = documentationReducer(
      loaded,
      updateColumnsInCurrentDocsData({
        columns: [{ name: "id", description: "new" }, { name: "missing" }],
      }),
    );
    expect(next.currentDocsData?.columns).toEqual([
      { ...docs("first").columns[0], description: "new" },
    ]);
    expect(loaded.currentDocsData?.columns[0].description).toBe("key");
  });

  it("clears doc blocks when the project changes", () => {
    const withBlocks = documentationReducer(
      loaded,
      setDocBlocks([{ name: "b", path: "p" }]),
    );
    const next = documentationReducer(withBlocks, setProject("other"));
    expect(next.project).toBe("other");
    expect(next.docBlocks).toEqual([]);
  });
});

describe("isStateDirty", () => {
  const withCurrent = (current: DBTDocumentation) =>
    documentationReducer(loaded, updateCurrentDocsData(current));

  it("is true after a type change", () => {
    const next = documentationReducer(
      loaded,
      updateColumnsInCurrentDocsData({
        columns: [{ name: "id", type: "integer" }],
      }),
    );
    expect(isStateDirty(next)).toBe(true);
  });

  it("is true after a column is added", () => {
    const current = docs("first");
    const next = withCurrent({
      ...current,
      columns: [
        ...current.columns,
        { name: "amount", generated: false, source: Source.DATABASE },
      ],
    });
    expect(isStateDirty(next)).toBe(true);
  });

  it("is false for identical documentation", () => {
    expect(isStateDirty(loaded)).toBe(false);
  });

  it("is false when only replaceType differs and the type is unchanged", () => {
    const current = docs("first");
    const next = withCurrent({
      ...current,
      columns: [{ ...current.columns[0]!, replaceType: true }],
    });
    expect(isStateDirty(next)).toBe(false);
  });
});

describe("applyColumnProposals", () => {
  const noChoices: ProposalChoices = { types: {}, descriptions: {} };
  const typed = (type: string | undefined) =>
    documentationReducer(
      initialState,
      setIncomingDocsData({
        docs: {
          ...docs("first"),
          columns: [{ ...docs("first").columns[0]!, type }],
        },
      }),
    );
  const applyTypes = (
    state: typeof loaded,
    types: columnProposals.TypeProposal[],
    choices: ProposalChoices = noChoices,
  ) =>
    documentationReducer(
      state,
      applyColumnProposals({
        proposals: { types, descriptions: [] },
        choices,
      }),
    );

  it("fills an empty type and keeps the column's shape", () => {
    const next = applyTypes(typed(undefined), [
      { column: "id", type: "integer", change: "fill" },
    ]);
    expect(next.currentDocsData?.columns).toEqual([
      {
        name: "id",
        type: "integer",
        description: "key",
        generated: false,
        source: Source.YAML,
        replaceType: undefined,
      },
    ]);
  });

  it("appends an added column as a database column", () => {
    const next = applyTypes(loaded, [
      { column: "amount", type: "numeric", change: "add" },
    ]);
    expect(next.currentDocsData?.columns.map((c) => c.name)).toEqual([
      "id",
      "amount",
    ]);
    expect(next.currentDocsData?.columns[1]).toEqual({
      name: "amount",
      type: "numeric",
      generated: false,
      source: Source.DATABASE,
    });
  });

  it("sets replaceType only for an overwrite that is ticked", () => {
    const state = typed("varchar");
    const overwrite: columnProposals.TypeProposal = {
      column: "id",
      type: "integer",
      change: "overwrite",
      current: "varchar",
    };
    const unticked = applyTypes(state, [overwrite]);
    expect(unticked.currentDocsData?.columns[0]?.type).toBe("varchar");
    expect(unticked.currentDocsData?.columns[0]?.replaceType).toBeFalsy();

    const ticked = applyTypes(state, [overwrite], {
      types: { id: { overwrite: true } },
      descriptions: {},
    });
    expect(ticked.currentDocsData?.columns[0]).toMatchObject({
      type: "integer",
      replaceType: true,
    });
  });
});
