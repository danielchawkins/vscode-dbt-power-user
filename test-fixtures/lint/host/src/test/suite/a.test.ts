// lint-expect-none: any eslint/no-restricted-properties
// lint-expect-none: any eslint/no-restricted-imports
import * as cp from "node:child_process";
import { window, workspace } from "vscode";

export const c = workspace.getConfiguration();
export const e = window.showErrorMessage;
export const p = cp;
