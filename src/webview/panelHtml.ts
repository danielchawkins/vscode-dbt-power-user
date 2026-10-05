import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { Uri, Webview, WebviewOptions } from "vscode";

/**
 * The Vite entries under `webview_panels/src/entries`, one per panel.
 * @internal
 */
export const panelEntries = [
  "documentationEditor",
  "queryResults",
  "lineage",
] as const;

export type PanelEntry = (typeof panelEntries)[number];

/** What a panel's page loads beyond its nonce'd scripts, its styles, codicons and images. */
export interface PanelCsp {
  /** WebAssembly compilation (`'wasm-unsafe-eval'`). */
  wasm?: boolean;
  /** `fetch` of the extension's own assets. */
  connect?: boolean;
  /** Workers started from `blob:` URLs. */
  blobWorkers?: boolean;
}

/** The page a panel host renders: its entry and the CSP allowances that entry needs. */
export interface PanelPage {
  entry: PanelEntry;
  csp: PanelCsp;
}

/** The fields of a Vite manifest chunk the host reads. */
interface ManifestChunk {
  file: string;
  name?: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
}

export type ViteManifest = Record<string, ManifestChunk>;

const assetRoot = (extensionUri: Uri) =>
  Uri.joinPath(extensionUri, "webview_panels", "dist", "assets");

/** Scripts on, and local resources limited to the built webview assets. */
export function panelWebviewOptions(extensionUri: Uri): WebviewOptions {
  return { enableScripts: true, localResourceRoots: [assetRoot(extensionUri)] };
}

/**
 * The entry's script and every stylesheet its static imports carry, as paths under `dist`.
 * @internal
 */
export function entryAssets(
  manifest: ViteManifest,
  entry: PanelEntry,
): { script: string; styles: string[] } {
  const key = Object.keys(manifest).find(
    (k) => manifest[k].isEntry && manifest[k].name === entry,
  );
  if (!key) {
    throw new Error(`The webview build has no entry named ${entry}`);
  }
  const styles = new Set<string>();
  const seen = new Set<string>();
  const visit = (k: string) => {
    if (seen.has(k)) {
      return;
    }
    seen.add(k);
    manifest[k].imports?.forEach(visit);
    manifest[k].css?.forEach((file) => styles.add(file));
  };
  visit(key);
  return { script: manifest[key].file, styles: [...styles] };
}

/**
 * The policy for one page: everything denied, then the shared allowances and the panel's own.
 * @internal
 */
export function contentSecurityPolicy(
  cspSource: string,
  nonce: string,
  csp: PanelCsp,
): string {
  return [
    "default-src 'none'",
    // The nonce admits the entry; `cspSource` admits the chunks it imports.
    `script-src 'nonce-${nonce}' ${cspSource}${csp.wasm ? " 'wasm-unsafe-eval'" : ""}`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `font-src ${cspSource}`,
    `img-src ${cspSource} data:`,
    ...(csp.connect ? [`connect-src ${cspSource}`] : []),
    ...(csp.blobWorkers ? ["worker-src blob:"] : []),
  ].join("; ");
}

const manifests = new Map<string, ViteManifest>();

function readManifest(extensionUri: Uri): ViteManifest {
  const file = Uri.joinPath(assetRoot(extensionUri), "manifest.json").fsPath;
  let manifest = manifests.get(file);
  if (!manifest) {
    manifest = JSON.parse(readFileSync(file, "utf8")) as ViteManifest;
    manifests.set(file, manifest);
  }
  return manifest;
}

/** The only HTML document any panel renders; `manifest` defaults to the built one. */
export function panelHtml(
  webview: Webview,
  extensionUri: Uri,
  page: PanelPage,
  manifest: ViteManifest = readManifest(extensionUri),
): string {
  const dist = Uri.joinPath(extensionUri, "webview_panels", "dist");
  const asset = (file: string) =>
    webview.asWebviewUri(Uri.joinPath(dist, file));
  const { script, styles } = entryAssets(manifest, page.entry);
  const nonce = randomBytes(16).toString("hex");
  const policy = contentSecurityPolicy(webview.cspSource, nonce, page.csp);
  const links = [...styles, "assets/codicons/codicon.css"]
    .map((file) => `<link rel="stylesheet" href="${asset(file)}">`)
    .join("\n    ");
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    ${links}
  </head>
  <body data-entry="${page.entry}">
    <div id="root"></div>
    <div id="sidebar"></div>
    <div id="modal"></div>
    <script nonce="${nonce}" type="module" src="${asset(script)}"></script>
  </body>
</html>`;
}
