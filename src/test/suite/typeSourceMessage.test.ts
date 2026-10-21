import { describe, expect, it } from "vitest";
import type { Attempt } from "../../core/columns/typeSourceMessage";
import { typeSourceMessage } from "../../core/columns/typeSourceMessage";

const RESTRICT =
  'Column types need strict static analysis; set fusionPowerUser.staticAnalysis to "strict".';

const attempts = (...tried: Attempt[]) => ({ attempts: tried });

describe("typeSourceMessage", () => {
  it("matches the issue's example sentence exactly", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          { source: "deferred", result: "notConfigured", detail: "default" },
          { source: "inferred", result: "answered" },
        ),
      ),
    ).toBe(
      "`m` is not built in target `dev`, and no deferred relation is configured. Build it with `dbt run -s m`, set up defer, or use the inferred types.",
    );
  });

  it("names a deferred relation that is missing too, and the state it came from", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          {
            source: "deferred",
            result: "missing",
            relation: '"prod"."m"',
            state: "/state",
          },
          { source: "inferred", result: "answered" },
        ),
      ),
    ).toBe(
      '`m` is not built in target `dev`, and the deferred relation `"prod"."m"` from state `/state` does not exist either. Build it with `dbt run -s m` or use the inferred types.',
    );
  });

  it("says defer is enabled without a manifest path, and offers setting defer up", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          { source: "deferred", result: "notConfigured", detail: "unset" },
          { source: "inferred", result: "unavailable" },
        ),
        RESTRICT,
      ),
    ).toBe(
      `\`m\` is not built in target \`dev\`, and defer is enabled without \`manifestPathForDeferral\`. Build it with \`dbt run -s m\` or set up defer. ${RESTRICT}`,
    );
  });

  it("says a defer path is neither a directory nor a manifest.json", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          {
            source: "deferred",
            result: "notConfigured",
            detail: "unusable",
            state: "/state/notes.txt",
          },
          { source: "inferred", result: "answered" },
        ),
      ),
    ).toBe(
      "`m` is not built in target `dev`, and `/state/notes.txt` is neither a directory nor a `manifest.json`. Build it with `dbt run -s m`, set up defer, or use the inferred types.",
    );
  });

  it("names the first line of a failed target, never the whole error", () => {
    const message = typeSourceMessage(
      "m",
      attempts(
        {
          source: "target",
          result: "failed",
          target: "dev",
          detail: "[error] Compilation Error\n  at line 4\n  stack",
        },
        { source: "deferred", result: "notConfigured", detail: "default" },
        { source: "inferred", result: "answered" },
      ),
    );
    expect(message).toBe(
      "Describing `m` in target `dev` failed: Compilation Error, and no deferred relation is configured. Set up defer or use the inferred types.",
    );
    expect(message).not.toContain("stack");
  });

  it("names a failed deferred describe by its first line", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          { source: "deferred", result: "failed", detail: "boom\nmore" },
          { source: "inferred", result: "unavailable" },
        ),
      ),
    ).toBe(
      "`m` is not built in target `dev`, and describing `m` in the deferred state failed: boom. Build it with `dbt run -s m`.",
    );
  });

  it("adds the static-analysis reason when inferred types are unavailable", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          { source: "deferred", result: "notConfigured", detail: "off" },
          { source: "inferred", result: "unavailable" },
        ),
        RESTRICT,
      ),
    ).toBe(
      `\`m\` is not built in target \`dev\`, and no deferred relation is configured. Build it with \`dbt run -s m\` or set up defer. ${RESTRICT}`,
    );
  });

  it("starts a lower-case reason as a sentence", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "deferred", result: "notConfigured", detail: "off" },
          { source: "inferred", result: "unavailable" },
        ),
        "static analysis is baseline, not strict.",
      ),
    ).toBe(
      "No deferred relation is configured. Set up defer. Static analysis is baseline, not strict.",
    );
  });

  it("leaves the reason out once inferred types are offered", () => {
    expect(
      typeSourceMessage(
        "m",
        attempts(
          { source: "target", result: "missing", target: "dev" },
          { source: "deferred", result: "notConfigured", detail: "default" },
          { source: "inferred", result: "answered" },
        ),
        RESTRICT,
      ),
    ).not.toContain("strict static analysis");
  });
});
