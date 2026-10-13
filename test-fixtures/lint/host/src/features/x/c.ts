// lint-expect: oxlint eslint/no-restricted-properties
// lint-expect: oxlint eslint/no-restricted-imports
import { env } from "node:process";

export const home = process.env.X;
export const e = env;
