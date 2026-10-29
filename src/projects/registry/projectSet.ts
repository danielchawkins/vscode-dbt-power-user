import * as path from "node:path";
import type { Uri, WorkspaceFolder } from "vscode";

/** How a Declared Project came to be declared. */
export type DeclaredProjectOrigin = "explicit" | "folderRoot" | "openedFile";

/** A project root that a workspace folder, a `projects` entry or an opened file declares. */
export interface Candidate {
  folder: WorkspaceFolder;
  root: Uri;
  name: string;
  realpathKey: string;
  origin: DeclaredProjectOrigin;
}

/** A candidate merged with every root spelling that resolves to its realpath. */
export interface DesiredProject extends Candidate {
  readonly aliases: readonly string[];
}

/** Merges the candidates that share a realpath into one desired project, keeping each root spelling as an alias. */
export function mergeByRealpath(
  candidates: readonly Candidate[],
): DesiredProject[] {
  const byRealpath = new Map<
    string,
    { candidate: Candidate; aliases: string[] }
  >();
  for (const candidate of candidates) {
    const existing = byRealpath.get(candidate.realpathKey);
    if (existing) {
      if (!existing.aliases.includes(candidate.root.fsPath)) {
        existing.aliases.push(candidate.root.fsPath);
      }
      // A configured root keeps its origin even when an opened file reached it first.
      if (
        existing.candidate.origin === "openedFile" &&
        candidate.origin !== "openedFile"
      ) {
        existing.candidate = { ...candidate, root: existing.candidate.root };
      }
    } else {
      byRealpath.set(candidate.realpathKey, {
        candidate,
        aliases: [...new Set([candidate.root.fsPath, candidate.realpathKey])],
      });
    }
  }
  return Array.from(byRealpath.values(), ({ candidate, aliases }) => ({
    ...candidate,
    aliases,
  }));
}

/**
 * The desired projects in order, each one the current project with the same identity, or else `create(desired)`.
 */
export function keepUnchanged<T extends DesiredProject>(
  current: readonly T[],
  desired: readonly DesiredProject[],
  create: (project: DesiredProject) => T,
): T[] {
  return desired.map(
    (d) =>
      current.find(
        (p) =>
          p.realpathKey === d.realpathKey &&
          p.root.fsPath === d.root.fsPath &&
          p.folder.uri.fsPath === d.folder.uri.fsPath &&
          p.name === d.name &&
          p.origin === d.origin &&
          samePaths(p.aliases, d.aliases),
      ) ?? create(d),
  );
}

/** Whether the two lists hold the same projects, by identity, in the same order. */
export function sameOrder<T>(
  previous: readonly T[],
  next: readonly T[],
): boolean {
  return (
    previous.length === next.length &&
    previous.every((project, i) => next[i] === project)
  );
}

/** Projects deepest root first, then by root path: the order a document's project is looked up in. */
export function lookupOrder<
  T extends { readonly root: { readonly fsPath: string } },
>(projects: readonly T[]): T[] {
  return projects.toSorted((a, b) => {
    const depth =
      b.root.fsPath.split(path.sep).length -
      a.root.fsPath.split(path.sep).length;
    return depth || b.root.fsPath.localeCompare(a.root.fsPath);
  });
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
