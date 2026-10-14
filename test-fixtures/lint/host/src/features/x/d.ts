// lint-expect: oxlint eslint/no-restricted-imports
import { spawn } from "node:child_process";

export const child = spawn;
export async function load(): Promise<unknown> {
  return import("node:child_process");
}
export const req = require("node:child_process");
