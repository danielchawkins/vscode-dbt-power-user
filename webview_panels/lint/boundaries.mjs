// Boundary lists for the webview ESLint and Oxlint configs. Frozen data; the vendor-name list
// is shared with the root module, so both workspaces reject the same strings.
import { vendorNameSyntax } from "../../lint/boundaries.mjs";

// Only the request executor posts to the host; every other file sends through its panel's requests module.
export const VSCODE_API_MESSAGE = "Send through the panel's requests module.";
export const vscodeApiPaths = Object.freeze([
  { name: "@vscodeApi", message: VSCODE_API_MESSAGE },
]);
export const vscodeApiPatterns = Object.freeze([
  {
    regex: "^(\\.{1,2}/(.*/)?|@modules/)vscode(/index(\\.ts)?)?$",
    message: VSCODE_API_MESSAGE,
  },
]);

export const postMessageSyntax = Object.freeze([
  {
    selector:
      "CallExpression[callee.property.name='postMessage']:not([callee.object.name='window'])",
    message: VSCODE_API_MESSAGE,
  },
]);

// The webview's source rule: the postMessage selector, then the vendor-name selectors.
export const webviewSourceSyntax = Object.freeze([
  ...postMessageSyntax,
  ...vendorNameSyntax,
]);
