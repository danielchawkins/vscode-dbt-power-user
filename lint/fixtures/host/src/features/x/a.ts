// lint-expect: oxlint eslint/no-restricted-properties
import { workspace } from "vscode";

export const config = workspace.getConfiguration();
