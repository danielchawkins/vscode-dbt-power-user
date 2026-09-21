import path from "node:path";
import { fileURLToPath } from "node:url";

export function esmDirname(metaUrl: string): string {
  return path.dirname(fileURLToPath(metaUrl));
}
