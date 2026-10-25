import { isAbsolute, relative, sep } from "node:path";

/**
 * True when `p` escapes `root`: `relative` climbs to `..` itself or past it, or lands on another drive or
 * root. A child whose name starts with two dots, such as `..scratch`, does not escape.
 */
function escapes(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * True when `p` is `root` or lies beneath it, compared by path segments: `/a/project` is not below `/a/proj`,
 * and trailing separators on either path do not matter.
 */
export function isAtOrBelow(root: string, p: string): boolean {
  return !escapes(root, p);
}

/** True when `p` lies beneath `root` and is not `root` itself. */
export function isStrictlyBelow(root: string, p: string): boolean {
  return relative(root, p) !== "" && !escapes(root, p);
}
