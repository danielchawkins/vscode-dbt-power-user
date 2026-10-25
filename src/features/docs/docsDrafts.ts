import type { documentationEditor } from "@fusion-power-user/webview-contract";
import * as path from "node:path";

type Draft = documentationEditor.DocumentationDraft;
type Column = documentationEditor.DocumentationColumn;

/**
 * Unsaved documentation drafts by model file path. Host memory only, never webview state. Paths are plain strings so
 * the store stays free of the editor API.
 */
export class DocsDrafts {
  private readonly drafts = new Map<string, Draft>();

  /** Holds `draft` for `model`; an undefined `draft` forgets the model's. */
  set(model: string, draft: Draft | undefined): void {
    if (draft) {
      this.drafts.set(model, draft);
    } else {
      this.forget(model);
    }
  }

  get(model: string): Draft | undefined {
    return this.drafts.get(model);
  }

  forget(model: string): void {
    this.drafts.delete(model);
  }

  /** Forgets the drafts under the project root `root`; a model that only shares the root's name prefix is kept. */
  forgetProject(root: string): void {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    for (const model of this.drafts.keys()) {
      if (model.startsWith(prefix)) {
        this.drafts.delete(model);
      }
    }
  }

  /** The columns a proposal or a save answers for: the draft's when the model has one, else the YAML's. */
  columnsFor(documentation: { filePath: string; columns: Column[] }): Column[] {
    return (
      this.drafts.get(documentation.filePath)?.docs.columns ??
      documentation.columns
    );
  }

  /** Model paths with an unsaved draft; the smoke suites check that none leak between them. */
  held(): string[] {
    return [...this.drafts.keys()];
  }
}
