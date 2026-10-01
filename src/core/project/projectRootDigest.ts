import { createHash } from "crypto";

/** A short, stable identifier of a Declared Project's root, safe in command ids, client ids and channel names. */
export function projectRootDigest(rootFsPath: string): string {
  return createHash("sha256")
    .update(rootFsPath)
    .digest("base64url")
    .slice(0, 12);
}
