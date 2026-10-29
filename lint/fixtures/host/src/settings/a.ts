// lint-expect-none: any eslint/no-restricted-properties
// lint-expect-none: any eslint/no-restricted-imports
import { workspace } from "vscode";

export const config = workspace.getConfiguration();
export const { getConfiguration } = workspace;
