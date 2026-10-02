import { randomBytes } from "crypto";
import { Uri, Webview, WebviewOptions } from "vscode";

/** What a panel's page loads beyond its nonce'd scripts, its styles, codicons and images. */
export interface PanelCsp {
  /** WebAssembly compilation (`'wasm-unsafe-eval'`). */
  wasm?: boolean;
  /** `fetch` of the extension's own assets. */
  connect?: boolean;
  /** Workers started from `blob:` URLs. */
  blobWorkers?: boolean;
}

/** The one bundle every panel loads starts Perspective, which fetches and compiles `.wasm` and runs a Blob worker. */
export const SHARED_BUNDLE_CSP: PanelCsp = {
  wasm: true,
  connect: true,
  blobWorkers: true,
};

/** The page a panel host renders: the bundle's route for the panel and the panel's CSP allowances. */
export interface PanelPage {
  viewPath: string;
  csp: PanelCsp;
}

const assetRoot = (extensionUri: Uri) =>
  Uri.joinPath(extensionUri, "webview_panels", "dist", "assets");

/** Scripts on, and local resources limited to the built webview assets. */
export function panelWebviewOptions(extensionUri: Uri): WebviewOptions {
  return { enableScripts: true, localResourceRoots: [assetRoot(extensionUri)] };
}

/** The policy for one page: everything denied, then the shared allowances and the panel's own. */
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

/** The only HTML document any panel renders. */
export function panelHtml(
  webview: Webview,
  extensionUri: Uri,
  page: PanelPage,
): string {
  const asset = (...parts: string[]) =>
    webview.asWebviewUri(Uri.joinPath(assetRoot(extensionUri), ...parts));
  const nonce = randomBytes(16).toString("hex");
  const policy = contentSecurityPolicy(webview.cspSource, nonce, page.csp);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <link rel="stylesheet" href="${asset("main.css")}">
    <link rel="stylesheet" href="${asset("codicons", "codicon.css")}">
  </head>
  <body class="${page.viewPath.replace(/\//g, "")}">
    <div id="root"></div>
    <div id="sidebar"></div>
    <div id="modal"></div>
    <script nonce="${nonce}">window.viewPath = ${JSON.stringify(page.viewPath)};</script>
    <script nonce="${nonce}" type="module" src="${asset("main.js")}"></script>
  </body>
</html>`;
}
