import { realpathSync } from "node:fs";
import * as path from "node:path";
import { Uri } from "vscode";
import type { LanguageClientOptions } from "vscode-languageclient/node";

/**
 * Fusion canonicalizes `--project-dir` but matches document URIs literally, so a project opened through a
 * symlink loads no documents. Returns the realpath to launch Fusion on and converters that move URIs between
 * the opened root and that realpath; converters are undefined when the two are the same.
 */
export function canonicalProjectRoot(
  root: string,
  realpath: (fsPath: string) => string = realpathSync.native,
): {
  launchRoot: string;
  uriConverters?: LanguageClientOptions["uriConverters"];
} {
  let launchRoot: string;
  try {
    launchRoot = realpath(root);
  } catch {
    return { launchRoot: root };
  }
  if (launchRoot === root) {
    return { launchRoot };
  }
  const remap = (
    fsPath: string,
    from: string,
    to: string,
  ): string | undefined => {
    if (fsPath === from) {
      return to;
    }
    return fsPath.startsWith(from + path.sep)
      ? to + fsPath.slice(from.length)
      : undefined;
  };
  return {
    launchRoot,
    uriConverters: {
      code2Protocol: (uri) => {
        const mapped =
          uri.scheme === "file"
            ? remap(uri.fsPath, root, launchRoot)
            : undefined;
        return (mapped ? Uri.file(mapped) : uri).toString();
      },
      protocol2Code: (value) => {
        const uri = Uri.parse(value);
        const mapped =
          uri.scheme === "file"
            ? remap(uri.fsPath, launchRoot, root)
            : undefined;
        return mapped ? Uri.file(mapped) : uri;
      },
    },
  };
}
