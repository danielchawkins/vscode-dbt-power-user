import { describe, expect, it } from "vitest";
import { initialState } from "./documentationReducer";
import { incomingDecision, type RenderMessage } from "./incomingDocs";
import type { EditorDocumentation, DocumentationStateProps } from "./types";

const docs = (description: string, name = "orders"): EditorDocumentation => ({
  name,
  description,
  columns: [
    {
      name: "id",
      description: "key",
      generated: false,
      source: "YAML",
    },
  ],
  generated: false,
  filePath: `/models/${name}.sql`,
  uniqueId: `model.p.${name}`,
});

const clean: DocumentationStateProps = {
  ...initialState,
  currentDocsData: docs("same"),
  incomingDocsData: { docs: docs("same") },
};

const dirty: DocumentationStateProps = {
  ...clean,
  currentDocsData: docs("edited"),
};

const draftOf = (model: string): Pick<RenderMessage, "draft"> => ({
  draft: { docs: docs("draft", model) },
});

describe("incomingDecision", () => {
  it("renders when the page has no unsaved edits", () => {
    expect(incomingDecision(clean, { draft: undefined })).toBe("render");
    expect(incomingDecision(clean, draftOf("customers"))).toBe("render");
  });

  it("asks when there are unsaved edits and the draft is for another model", () => {
    expect(incomingDecision(dirty, draftOf("customers"))).toBe("ask");
  });

  it("asks when there are unsaved edits and no draft comes with the render", () => {
    expect(incomingDecision(dirty, { draft: undefined })).toBe("ask");
  });

  it("renders without the draft when the draft is for the open model", () => {
    expect(incomingDecision(dirty, draftOf("orders"))).toBe(
      "renderWithoutDraft",
    );
  });
});
