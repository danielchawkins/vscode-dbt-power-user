import path from "node:path";
import { esmDirname } from "../esmDirname";

/** Test stand-in for bundled `dist/` media resolution. */
export const extensionRoot = path.resolve(
  esmDirname(import.meta.url),
  "../../../dist",
);
