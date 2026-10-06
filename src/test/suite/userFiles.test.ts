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

  it("replaces only the changed range of an existing file and saves it", async () => {
    expect(await writeUserFile(existing(), "new text")).toBe("saved");

    const [replacement] = lastEdit().replacements;
    expect(replacement.range.start).toEqual(new Position(0, 0));
    expect(replacement.range.end).toEqual(new Position(0, 3));
    expect(replacement.newText).toBe("new");
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

    expect(lastEdit().replacements[0].newText).toBe("new");
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

  it("keeps the unchanged prefix and suffix out of the edit", async () => {
    openWith("models:\n  - name: a\n  - name: c\n");

    await writeUserFile(
      existing(),
      "models:\n  - name: a\n  - name: b\n  - name: c\n",
    );

    const [replacement] = lastEdit().replacements;
    const before = "models:\n  - name: a\n  - name: c\n";
    // The mock's positionAt reports the offset as the character of line 0.
    expect(replacement.range.start.character).toBeGreaterThan(
      "models:\n  - name: a\n".length - 1,
    );
    expect(replacement.range.end.character).toBeLessThan(before.length);
    expect(
      before.slice(0, replacement.range.start.character) +
        replacement.newText +
        before.slice(replacement.range.end.character),
    ).toBe("models:\n  - name: a\n  - name: b\n  - name: c\n");
  });

  it("does not split a surrogate pair at either end of the edit", async () => {
    // U+1F600 and U+1F601 share a high surrogate.
    openWith("a\u{1F600}z");

    await writeUserFile(existing(), "a\u{1F601}z");

    const [replacement] = lastEdit().replacements;
    expect(replacement.range.start.character).toBe(1);
    expect(replacement.range.end.character).toBe(3);
    expect(replacement.newText).toBe("\u{1F601}");
  });
});
