// lint-expect: oxlint typescript/consistent-type-imports
import { Readable } from "node:stream";
export const first = (r: Readable): Readable => r;
