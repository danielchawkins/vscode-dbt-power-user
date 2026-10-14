#!/usr/bin/env node
// Usage: node scripts/quality/dependency-health.mjs
// Fails on any npm audit finding or `deprecated` lockfile entry. An unreachable registry only warns locally.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");

const CONNECTION = /reason: (?:connect |getaddrinfo |read )?([A-Z_]+)\b/;
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ENETUNREACH",
]);
const TIMEOUT = /^network timeout at: /;
const HTTP_UNAVAILABLE = /^(5\d\d|429) .* - POST /;

/** Returns one `{ name, severity, via }` per vulnerable package, every severity included. */
export function auditFindings(report) {
  return Object.values(report.vulnerabilities ?? {}).map(
    ({ name, severity, via }) => ({
      name,
      severity,
      via,
    }),
  );
}

/**
 * Returns why npm could not reach the registry, or null. Only a report without `vulnerabilities` can
 * qualify, and its message must match a connection error, a timeout, or an HTTP 5xx or 429.
 */
export function auditUnreachable(report) {
  if (report.vulnerabilities !== undefined) return null;
  const message = report.message ?? "";
  const code = CONNECTION.exec(message)?.[1];
  if (code && CONNECTION_CODES.has(code)) return code;
  if (TIMEOUT.test(message)) return "ETIMEDOUT";
  const status = HTTP_UNAVAILABLE.exec(message)?.[1];
  return status ? `HTTP ${status}` : null;
}

/** Returns each `packages` entry of the lockfile that is marked `deprecated`. */
export function deprecatedPackages(lock) {
  return Object.entries(lock.packages ?? {})
    .filter(([, meta]) => meta.deprecated)
    .map(([location, meta]) => ({
      path: location,
      version: meta.version,
      message: meta.deprecated,
    }));
}

/**
 * Decides the exit code and the lines to print. An unreachable registry is a warning unless `ci` is set,
 * in which case it fails, as does any other audit error.
 */
export function outcome({ findings, deprecated, unreachable, otherError, ci }) {
  const lines = [];
  let exitCode = 0;
  if (otherError) {
    lines.push(`npm audit failed: ${otherError}`);
    exitCode = 1;
  }
  if (unreachable && ci) {
    lines.push(
      `npm audit could not reach the registry (${unreachable}); CI does not skip the audit`,
    );
    exitCode = 1;
  } else if (unreachable) {
    lines.push(
      `warning: npm audit skipped, registry unreachable (${unreachable}); CI runs the audit`,
    );
  }
  for (const { name, severity } of findings) {
    lines.push(`audit finding: ${name} (${severity})`);
    exitCode = 1;
  }
  for (const { path: location, version, message } of deprecated) {
    lines.push(`deprecated: ${location}@${version}: ${message}`);
    exitCode = 1;
  }
  return { exitCode, lines };
}

/**
 * Runs `npm audit --json`. npm exits non-zero for findings and for failures, so the report is read from
 * stdout. A spawn that fails (ENOENT, for example) sets `error` and leaves stdout and stderr unset.
 * @typedef {object} SpawnResult
 * @property {Error} [error]
 * @property {number | null} [status]
 * @property {string} [stdout]
 * @property {string} [stderr]
 * @param {(command: string, args: string[], options: object) => SpawnResult} [run]
 */
export function runAudit(run = spawnSync) {
  const result = run("npm", ["audit", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) {
    return { message: result.error.message };
  }
  try {
    return JSON.parse(result.stdout ?? "");
  } catch {
    return {
      message:
        (result.stderr?.trim() ?? "") || `npm audit exited ${result.status}`,
    };
  }
}

function main() {
  const report = runAudit();
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  const unreachable = auditUnreachable(report);
  const { exitCode, lines } = outcome({
    findings: auditFindings(report),
    deprecated: deprecatedPackages(lock),
    unreachable,
    otherError:
      report.vulnerabilities === undefined && !unreachable
        ? (report.message ?? "no vulnerabilities report")
        : null,
    ci: process.env.CI === "true",
  });
  for (const line of lines) {
    console.error(line);
  }
  return exitCode;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main();
}
