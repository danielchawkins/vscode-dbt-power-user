// lint-expect: oxlint eslint/no-restricted-imports 2
import { vscode } from "@vscodeApi";
import "../vscode";

export const v = vscode;
