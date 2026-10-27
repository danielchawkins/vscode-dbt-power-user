import { isAbsolute, join, relative, sep } from "node:path";

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

/** Fusion's log directory under the project root: the launch passes no `--log-path`, so dbt's default applies. */
const DEFAULT_LOG_DIRECTORY = "logs";

/**
 * True when `p` lies under the target directory or the log directory of the project at `root`. The server writes
 * there itself, so its watched-file events for those files are echoes of its own output. A directory that is the
 * root itself is never excluded, because every file of the project lies beneath it.
 */
export function serverIgnoresPath(
  root: string,
  targetPath: string,
  p: string,
): boolean {
  return [targetPath, join(root, DEFAULT_LOG_DIRECTORY)]
    .filter((dir) => isStrictlyBelow(root, dir))
    .some((dir) => isAtOrBelow(dir, p));
}
