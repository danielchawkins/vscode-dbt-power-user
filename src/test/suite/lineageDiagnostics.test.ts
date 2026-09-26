import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";
import {
  classifyCompile,
  CompileOutcome,
  describeCompileOutcome,
} from "../../fusion/lineageDiagnostics";
import { esmDirname } from "../esmDirname";

/** Output of experiment f1 (Fusion 2.0.6), one step per outcome. */
function captured(name: string) {
  const dir = path.join(
    esmDirname(import.meta.url),
    "fixtures",
    "fusion-compile-2.0.6",
  );
  const read = (suffix: string) =>
    readFileSync(path.join(dir, `${name}.${suffix}.txt`), "utf8");
  return {
    exitCode: Number(read("exit").trim()),
    stdout: read("stdout"),
    stderr: read("stderr"),
  };
}

const classify = ({ exitCode, stdout, stderr }: ReturnType<typeof captured>) =>
  classifyCompile(exitCode, stdout, stderr);

describe("classifyCompile on captured Fusion 2.0.6 output", () => {
  it("analyzed: strict compile with local origin", () => {
    expect(classify(captured("analyzed"))).toEqual({ kind: "analyzed" });
  });

  it("dbt1000: info schema generated under baseline", () => {
    expect(classify(captured("no-strict"))).toEqual({
      kind: "strictUnavailable",
      signal: "dbt1000",
    });
  });

  it("skipped: remote origin with a dropped source table", () => {
    expect(classify(captured("remote-dropped-source"))).toEqual({
      kind: "skipped",
      models: ["model.lineage_probe.hard"],
    });
  });

  it("failed: a SQL error under strict, with the error line as the message", () => {
    const outcome = classify(captured("strict-sql-error"));
    expect(outcome).toMatchObject({ kind: "failed", exitCode: 1 });
    expect(outcome.kind === "failed" && outcome.message).toMatch(
      /^\[error\] \[UnresolvedIdentifier \(dbt0227\)\]/,
    );
  });
});

describe("classifyCompile edge cases", () => {
  it("recognises the licence message", () => {
    expect(
      classifyCompile(
        0,
        "Continuing without dbt platform. Strict static analysis will be unavailable.\n",
        "",
      ),
    ).toEqual({ kind: "strictUnavailable", signal: "licence" });
  });

  it("treats a signal-killed process as failed", () => {
    expect(classifyCompile(null, "", "")).toMatchObject({
      kind: "failed",
      exitCode: -1,
    });
  });

  it("collects each skipped model once", () => {
    const stderr = [
      "[warning] [RemoteError (dbt1014)]: … Skipping analysis for 'model.p.a': x",
      "[warning] [RemoteError (dbt1014)]: … Skipping analysis for 'model.p.b': y",
      "[warning] [RemoteError (dbt1014)]: … Skipping analysis for 'model.p.a': z",
    ].join("\n");
    expect(classifyCompile(0, "", stderr)).toEqual({
      kind: "skipped",
      models: ["model.p.a", "model.p.b"],
    });
  });
});

describe("describeCompileOutcome", () => {
  it.each<[CompileOutcome, RegExp]>([
    [{ kind: "analyzed" }, /up to date/],
    [
      { kind: "skipped", models: ["model.p.a"] } as const,
      /model\.p\.a.*dbt1014/,
    ],
    [{ kind: "strictUnavailable", signal: "licence" }, /dbt platform/],
    [{ kind: "strictUnavailable", signal: "dbt1000" }, /dbt1000/],
    [
      { kind: "strictUnavailable", signal: "emptyAfterStrict" },
      /may not have taken effect/,
    ],
    [{ kind: "failed", exitCode: 1, message: "boom" }, /failed: boom/],
  ])("%j", (outcome, expected) => {
    expect(describeCompileOutcome(outcome)).toMatch(expected);
  });
});
