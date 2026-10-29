// lint-expect: oxlint eslint/no-restricted-properties
// lint-expect: oxlint eslint/no-restricted-imports
import { writeFile } from "node:fs/promises";

declare const fs: { writeFileSync(path: string, data: string): void };

export function save(): void {
  fs.writeFileSync("a", "b");
}
export const w = writeFile;
