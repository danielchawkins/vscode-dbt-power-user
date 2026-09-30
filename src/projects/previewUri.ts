import { posix } from "path";
import { Uri } from "vscode";

export const PREVIEW_SCHEME = "query-preview";

/**
 * The compiled preview URI for a model: `query-preview:/<model stem>.sql?<encoded model URI>`. The path sits outside
 * every contributed `filenamePatterns`, so VS Code assigns the built-in `sql` language from the `.sql` extension.
 */
export function previewUriFor(model: Uri): Uri {
  return Uri.from({
    scheme: PREVIEW_SCHEME,
    path: `/${posix.parse(model.path).name}.sql`,
    query: encodeURIComponent(model.toString()),
  });
}

/** The model URI a compiled preview URI was built from, or `undefined` for any other URI. */
export function modelUriOf(preview: Uri): Uri | undefined {
  if (preview.scheme !== PREVIEW_SCHEME || !preview.query) {
    return undefined;
  }
  try {
    return Uri.parse(decodeURIComponent(preview.query), true);
  } catch {
    return undefined;
  }
}

/** The model an editor URI stands for: a compiled preview resolves to its model, any other URI to itself. */
export function activeModelUri(uri: Uri): Uri {
  return modelUriOf(uri) ?? uri;
}
