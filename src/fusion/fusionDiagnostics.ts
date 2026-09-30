import { existsSync } from "fs";
import * as path from "path";
import {
  type DiagnosticCollection,
  type Disposable,
  RelativePattern,
  Uri,
  workspace,
} from "vscode";

// Folder deletes fire one event for the folder path, so a file-extension glob would miss them.
const WATCHED_PROJECT_FILES = "**/*";

/** True when `fsPath` is `root` or lies under it, compared by path segments. */
export function isWithinRoot(fsPath: string, root: string): boolean {
  const relative = path.relative(root, fsPath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/**
 * Forwards a `publishDiagnostics` URI when it is not a `file:` URI, was forwarded before, or names an existing
 * file under one of `roots`.
 */
export class ProjectDiagnosticsFilter {
  private readonly forwarded = new Set<string>();

  constructor(
    private readonly roots: readonly string[],
    private readonly exists: (fsPath: string) => boolean = existsSync,
  ) {}

  shouldForward(uri: Uri): boolean {
    const key = uri.toString();
    if (uri.scheme !== "file" || this.forwarded.has(key)) {
      this.forwarded.add(key);
      return true;
    }
    const inProject = this.roots.some((root) => isWithinRoot(uri.fsPath, root));
    if (inProject && this.exists(uri.fsPath)) {
      this.forwarded.add(key);
      return true;
    }
    return false;
  }
}

/** Removes diagnostics for project files, and every entry under project folders, deleted on disk. */
export function clearDiagnosticsOnDelete(
  root: Uri,
  diagnostics: () => DiagnosticCollection | undefined,
): Disposable {
  const watcher = workspace.createFileSystemWatcher(
    new RelativePattern(root, WATCHED_PROJECT_FILES),
    true,
    true,
    false,
  );
  const listener = watcher.onDidDelete((deleted) => {
    const collection = diagnostics();
    if (!collection) {
      return;
    }
    const stale: Uri[] = [deleted];
    collection.forEach((uri) => {
      if (uri.scheme === "file" && isWithinRoot(uri.fsPath, deleted.fsPath)) {
        stale.push(uri);
      }
    });
    for (const uri of stale) {
      collection.delete(uri);
    }
  });
  return {
    dispose: () => {
      listener.dispose();
      watcher.dispose();
    },
  };
}
