import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  auditFindings,
  auditUnreachable,
  deprecatedPackages,
  outcome,
  runAudit,
} from "../../../../scripts/quality/dependency-health.mjs";
import { esmDirname } from "../../esmDirname";

const fixturesRoot = path.resolve(
  esmDirname(import.meta.url),
  "../fixtures/npm-audit-11.19",
);
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(path.join(fixturesRoot, `${name}.json`), "utf8"));

const unreachableFixtures: [string, string][] = [
  ["connect-econnrefused", "ECONNREFUSED"],
  ["getaddrinfo-enotfound", "ENOTFOUND"],
  ["econnreset", "ECONNRESET"],
  ["etimedout", "ETIMEDOUT"],
  ["derived-eai-again", "EAI_AGAIN"],
  ["derived-enetunreach", "ENETUNREACH"],
  ["http-500", "HTTP 500"],
  ["http-502", "HTTP 502"],
  ["http-503", "HTTP 503"],
  ["http-504", "HTTP 504"],
  ["http-429", "HTTP 429"],
];

const causes = unreachableFixtures.map(([, cause]) => cause);

describe("auditFindings", () => {
  it("returns no entries for a report with zero findings", () => {
    expect(auditFindings({ vulnerabilities: {} })).toEqual([]);
  });

  it("reports info and low findings", () => {
    const report = {
      vulnerabilities: {
        a: { name: "a", severity: "info", via: [] },
        b: { name: "b", severity: "low", via: ["a"] },
      },
    };
    expect(auditFindings(report)).toEqual([
      { name: "a", severity: "info", via: [] },
      { name: "b", severity: "low", via: ["a"] },
    ]);
  });
});

describe("auditUnreachable", () => {
  it.each(unreachableFixtures)("gives the cause for %s", (name, cause) => {
    expect(auditUnreachable(loadFixture(name))).toBe(cause);
  });

  it.each(["http-401", "http-403", "http-404"])("gives null for %s", (name) => {
    expect(auditUnreachable(loadFixture(name))).toBeNull();
  });

  it("gives null for an error with any other message", () => {
    expect(
      auditUnreachable({ message: "something else went wrong" }),
    ).toBeNull();
  });

  it("gives null when the report has a vulnerabilities key", () => {
    expect(
      auditUnreachable({
        vulnerabilities: {},
        message: "503 Service Unavailable - POST x",
      }),
    ).toBeNull();
  });
});

describe("outcome", () => {
  const clean = {
    findings: [],
    deprecated: [],
    otherError: null,
    unreachable: null,
  };
  const deprecated = [
    { path: "node_modules/x", version: "1.0.0", message: "old" },
  ];

  it.each(causes)("warns and exits 0 for %s when not CI", (cause) => {
    const { exitCode, lines } = outcome({
      ...clean,
      unreachable: cause,
      ci: false,
    });
    expect(exitCode).toBe(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("warning");
    expect(lines[0]).toContain(cause);
  });

  it("lets a deprecated entry fail the run when the audit is skipped locally", () => {
    const { exitCode } = outcome({
      ...clean,
      deprecated,
      unreachable: "HTTP 503",
      ci: false,
    });
    expect(exitCode).toBe(1);
  });

  it.each(causes)("fails for %s when CI", (cause) => {
    const { exitCode, lines } = outcome({
      ...clean,
      unreachable: cause,
      ci: true,
    });
    expect(exitCode).toBe(1);
    expect(lines.join("\n")).toContain(cause);
  });

  it("fails an otherError both locally and in CI", () => {
    for (const ci of [false, true]) {
      expect(
        outcome({ ...clean, otherError: "404 Not Found", ci }).exitCode,
      ).toBe(1);
    }
  });

  it("fails a finding both locally and in CI", () => {
    const findings = [{ name: "a", severity: "high", via: [] }];
    for (const ci of [false, true]) {
      expect(outcome({ ...clean, findings, ci }).exitCode).toBe(1);
    }
  });

  it("exits 0 with nothing to report", () => {
    expect(outcome({ ...clean, ci: true })).toEqual({ exitCode: 0, lines: [] });
  });
});

describe("deprecatedPackages", () => {
  it("reports a nested entry under its full node_modules path", () => {
    const lock = {
      packages: {
        "": {},
        "node_modules/a/node_modules/b": {
          version: "1.0.0",
          deprecated: "old",
        },
      },
    };
    expect(deprecatedPackages(lock)).toEqual([
      {
        path: "node_modules/a/node_modules/b",
        version: "1.0.0",
        message: "old",
      },
    ]);
  });

  it("gives an empty list for a lockfile without deprecated entries", () => {
    expect(
      deprecatedPackages({
        packages: { "node_modules/a": { version: "1.0.0" } },
      }),
    ).toEqual([]);
  });
});

describe("runAudit", () => {
  it("turns a spawn that fails with ENOENT into a failing outcome", () => {
    const spawnFails = () => ({
      error: Object.assign(new Error("spawnSync npm ENOENT"), {
        code: "ENOENT",
      }),
      status: null,
      stdout: undefined,
      stderr: undefined,
    });
    const report = runAudit(spawnFails);
    expect(auditUnreachable(report)).toBeNull();
    expect(
      outcome({
        findings: auditFindings(report),
        deprecated: [],
        unreachable: null,
        otherError: report.message,
        ci: false,
      }),
    ).toEqual({
      exitCode: 1,
      lines: ["npm audit failed: spawnSync npm ENOENT"],
    });
  });

  it("does not throw when a spawn returns no stdout and no error", () => {
    const report = runAudit(() => ({ status: 1, stdout: undefined }));
    expect(report).toEqual({ message: "npm audit exited 1" });
  });
});
