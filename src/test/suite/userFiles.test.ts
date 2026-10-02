import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Position, Uri, workspace } from "vscode";
import { writeUserFile } from "../../projects/userFiles";
import { createMockTextDocument, type WorkspaceEdit } from "../mock/vscode";

describe("user files", () => {
  let root: string;
  let document: ReturnType<typeof createMockTextDocument>;

  const openWith = (text: string, isDirty = false) => {
    document = createMockTextDocument(text, isDirty);
    vi.mocked(workspace.openTextDocument).mockResolvedValue(document as never);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "user-files-"));
    vi.mocked(workspace.applyEdit).mockClear();
    vi.mocked(workspace.applyEdit).mockResolvedValue(true);
    vi.mocked(workspace.openTextDocument).mockClear();
    openWith("old text");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const lastEdit = () =>
    vi.mocked(workspace.applyEdit).mock.calls[0][0] as unknown as WorkspaceEdit;

  const existing = () => {
    const file = path.join(root, "schema.yml");
    writeFileSync(file, "old text");
    return Uri.file(file);
  };

  it("creates an absent file with its contents, rendered from empty text, and writes nothing to disk", async () => {
    const file = path.join(root, "new.yml");

    expect(
      await writeUserFile(
        Uri.file(file),
        (current) => `${current}models: []\n`,
      ),
    ).toBe("saved");

    const [created] = lastEdit().createdFiles;
    expect(created.uri).toBe(Uri.file(file));
    expect(new TextDecoder().decode(created.options?.contents)).toBe(
      "models: []\n",
    );
    expect(workspace.openTextDocument).not.toHaveBeenCalled();
  });

  it("replaces the whole text of an existing file and saves it", async () => {
    expect(await writeUserFile(existing(), "new text")).toBe("saved");

    const [replacement] = lastEdit().replacements;
    expect(replacement.range.start).toEqual(new Position(0, 0));
    expect(replacement.range.end).toEqual(new Position(0, 8));
    expect(replacement.newText).toBe("new text");
    expect(document.save).toHaveBeenCalledOnce();
    expect(readFileSync(path.join(root, "schema.yml"), "utf8")).toBe(
      "old text",
    );
  });

  it("renders the new text from the document's text, including unsaved changes", async () => {
    openWith("unsaved text", true);

    await writeUserFile(existing(), (current) => current.toUpperCase());

    expect(lastEdit().replacements[0].newText).toBe("UNSAVED TEXT");
  });

  it("applies the edit to a document with unsaved changes and leaves it unsaved", async () => {
    openWith("unsaved text", true);

    expect(await writeUserFile(existing(), "new text")).toBe("applied-unsaved");

    expect(lastEdit().replacements[0].newText).toBe("new text");
    expect(document.save).not.toHaveBeenCalled();
  });

  it("does not save when the editor rejects the edit", async () => {
    vi.mocked(workspace.applyEdit).mockResolvedValue(false);

    expect(await writeUserFile(existing(), "new text")).toBe("rejected");
    expect(document.save).not.toHaveBeenCalled();
  });

  it("reports a failed save as rejected", async () => {
    document.save.mockResolvedValue(false);

    expect(await writeUserFile(existing(), "new text")).toBe("rejected");
  });
});
