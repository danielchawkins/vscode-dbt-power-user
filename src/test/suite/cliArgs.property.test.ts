import fc from "fast-check";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { CliCommand, PathKind, toCliArgs } from "../../core/cli";
import { ProjectSnapshot, resolveProjectSnapshot } from "../../core/project";
import { snapshotInputs } from "../arbitraries/projectSnapshot";

/** Above the shared run count: argv construction is cheap and the input space is wide. */
const CLI_ARGS_RUNS = 1000;

const snapshots = snapshotInputs.map(resolveProjectSnapshot);

/** Payloads with spaces, quotes, `;`, a leading `--` and `$`. */
const payload = fc.oneof(
  fc.string(),
  fc.string({ unit: fc.constantFrom(" ", "'", '"', ";", "-", "$", "{", "a") }),
  fc.string().map((s) => `--${s}`),
);

const selections = fc.option(payload, { nil: undefined });
const fullRefreshes = fc.option(fc.boolean(), { nil: undefined });

const commands: fc.Arbitrary<CliCommand> = fc.oneof(
  fc
    .tuple(selections, fullRefreshes)
    .map(([select, fullRefresh]): CliCommand => ({
      kind: "run",
      select,
      fullRefresh,
    })),
  fc
    .tuple(selections, fullRefreshes)
    .map(([select, fullRefresh]): CliCommand => ({
      kind: "build",
      select,
      fullRefresh,
    })),
  selections.map((select): CliCommand => ({ kind: "test", select })),
  selections.map((select): CliCommand => ({ kind: "compile", select })),
  payload.map((node): CliCommand => ({ kind: "compileNode", node })),
  fc
    .record({ sql: payload, output: fc.constantFrom("json", "quiet") })
    .map(({ sql, output }): CliCommand => ({
      kind: "compileInline",
      sql,
      output,
    })),
  fc
    .record({
      sql: payload,
      limit: fc.integer({ min: -1, max: 10_000 }),
    })
    .map((show): CliCommand => ({ kind: "show", ...show })),
  fc.constantFrom<CliCommand>(
    { kind: "parse" },
    { kind: "deps" },
    { kind: "clean" },
    { kind: "debug" },
  ),
);

/** What every probed path is on disk. */
const pathKinds = fc.constantFrom<PathKind>("directory", "file", "missing");

const cases = fc.tuple(snapshots, commands, pathKinds);

const DEFERRABLE = new Set(["run", "build", "test", "compile"]);
const count = (args: readonly string[], value: string) =>
  args.filter((arg) => arg === value).length;

function paramsFor(s: ProjectSnapshot, c: CliCommand): readonly string[] {
  const { run, build, test } = s.invocation.commandParams;
  if (c.kind === "run") {
    return run;
  }
  if (c.kind === "test") {
    return test;
  }
  return c.kind === "build" && c.select !== undefined ? build : [];
}

/** The selection or SQL elements, which sit right after the subcommand and its flag. */
function payloadOf(c: CliCommand): string[] {
  switch (c.kind) {
    case "run":
    case "test":
    case "compile":
    case "build":
      return c.select === undefined ? [] : [c.select];
    case "compileNode":
      return [c.node];
    case "compileInline":
      return [c.sql];
    case "show":
      return [];
    default:
      return [];
  }
}

/** Every element the caller supplied, so flag counts can exclude them. */
function supplied(s: ProjectSnapshot, c: CliCommand): string[] {
  return [
    ...paramsFor(s, c),
    ...payloadOf(c),
    ...(c.kind === "show" ? [c.sql] : []),
  ];
}

const FULL_REFRESH = "--full-refresh";

const wantsFullRefresh = (c: CliCommand) =>
  (c.kind === "run" || c.kind === "build") && c.fullRefresh === true;

/** Whether the implementation should add `--full-refresh` itself. */
const addsFullRefresh = (s: ProjectSnapshot, c: CliCommand) =>
  wantsFullRefresh(c) && !paramsFor(s, c).includes(FULL_REFRESH);

/** Where the command params start: after the subcommand, `--select <payload>`, and an added `--full-refresh`. */
const paramsStart = (s: ProjectSnapshot, c: CliCommand) =>
  1 + (payloadOf(c).length > 0 ? 2 : 0) + (addsFullRefresh(s, c) ? 1 : 0);

/** Whether a param sets the flag, written without the implementation's helper. */
const setsFlag = (param: string, name: string, alias?: string) =>
  param.split("=")[0] === name ||
  (alias !== undefined && param.startsWith(alias));

/** The `--state` directory the snapshot's defer should produce when every path is `kind`, or undefined. */
function expectedState(s: ProjectSnapshot, kind: PathKind): string | undefined {
  const defer = s.invocation.defer;
  const manifestPath = defer?.manifestPath;
  if (!defer?.deferToProduction || !manifestPath) {
    return undefined;
  }
  if (kind === "directory") {
    return manifestPath;
  }
  return kind === "file" && path.basename(manifestPath) === "manifest.json"
    ? path.dirname(manifestPath)
    : undefined;
}

const property = (
  predicate: (
    s: ProjectSnapshot,
    c: CliCommand,
    args: string[],
    kind: PathKind,
  ) => void,
) =>
  fc.assert(
    fc.property(cases, ([s, c, kind]) =>
      predicate(
        s,
        c,
        toCliArgs(s, c, () => kind),
        kind,
      ),
    ),
    { numRuns: CLI_ARGS_RUNS },
  );

describe("toCliArgs properties", () => {
  it("is pure: equal inputs give equal argv, and a frozen snapshot is not mutated", () => {
    property((s, c, args, kind) => {
      const frozen = Object.freeze(structuredClone(s));
      const before = structuredClone(frozen);
      expect(toCliArgs(frozen, c, () => kind)).toEqual(args);
      expect(frozen).toEqual(before);
    });
  });

  it("keeps each selection and SQL payload as one byte-equal element after the subcommand", () => {
    property((s, c, args) => {
      const subcommand = c.kind.startsWith("compile") ? "compile" : c.kind;
      expect(args[0]).toBe(subcommand);
      const expected = payloadOf(c);
      expect(args.slice(2, 2 + expected.length)).toEqual(expected);
      if (c.kind === "show") {
        expect(args[args.indexOf("--inline") + 1]).toBe(c.sql);
      }
    });
  });

  it("appends the kind's command params, in order, right after the selection", () => {
    property((s, c, args) => {
      const params = paramsFor(s, c);
      if (params.length === 0) {
        return;
      }
      const start = paramsStart(s, c);
      expect(args.slice(start, start + params.length)).toEqual(params);
    });
  });

  it("has --full-refresh exactly once when asked for or set once in the command params", () => {
    property((s, c, args) => {
      const given = count(paramsFor(s, c), FULL_REFRESH);
      expect(
        count(args, FULL_REFRESH) - count(supplied(s, c), FULL_REFRESH),
      ).toBe(addsFullRefresh(s, c) ? 1 : 0);
      const inPayload = count(payloadOf(c), FULL_REFRESH);
      if (
        inPayload === 0 &&
        given <= 1 &&
        (wantsFullRefresh(c) || given === 1)
      ) {
        expect(count(args, FULL_REFRESH)).toBe(1);
      }
    });
  });

  it("ignores command params on kinds that take none", () => {
    property((s, c, args, kind) => {
      if (paramsFor(s, c).length > 0 || ["run", "test"].includes(c.kind)) {
        return;
      }
      const empty = {
        ...s,
        invocation: {
          ...s.invocation,
          commandParams: { run: [], build: [], test: [] },
        },
      };
      expect(toCliArgs(empty, c, () => kind)).toEqual(args);
    });
  });

  it("adds each snapshot flag once, with its value, unless the command params set it in any form", () => {
    property((s, c, args) => {
      const params = paramsFor(s, c);
      const flags: [string, string | undefined, string?][] = [
        ["--target", s.invocation.target, "-t"],
        ["--profiles-dir", s.invocation.profilesDir],
        ["--project-dir", s.root],
      ];
      for (const [name, value, alias] of flags) {
        const added =
          value !== undefined && !params.some((p) => setsFlag(p, name, alias));
        expect(count(args, name)).toBe(
          count(supplied(s, c), name) + (added ? 1 : 0),
        );
        if (added) {
          expect(args[args.lastIndexOf(name) + 1]).toBe(value);
        }
      }
    });
  });

  it("defers iff enabled with a usable state path, passes --no-defer iff disabled, only on deferrable kinds", () => {
    property((s, c, args, kind) => {
      const params = supplied(s, c);
      const added = (flag: string) => count(args, flag) - count(params, flag);
      const [defer, noDefer, state, favor] = [
        "--defer",
        "--no-defer",
        "--state",
        "--favor-state",
      ].map(added);
      if (!DEFERRABLE.has(c.kind)) {
        expect([defer, noDefer, state, favor]).toEqual([0, 0, 0, 0]);
        return;
      }
      const stateDir = expectedState(s, kind);
      expect(defer).toBe(stateDir === undefined ? 0 : 1);
      expect(noDefer).toBe(s.invocation.defer?.deferToProduction ? 0 : 1);
      expect(state).toBe(defer);
      expect(favor).toBe(defer && s.invocation.defer?.favorState ? 1 : 0);
      if (stateDir !== undefined) {
        expect(args[args.lastIndexOf("--state") + 1]).toBe(stateDir);
      }
    });
  });

  it("never adds --static-analysis or --generate-info-schema", () => {
    property((s, c, args) => {
      const given = supplied(s, c);
      expect(
        count(args, "--generate-info-schema") -
          count(given, "--generate-info-schema"),
      ).toBe(0);
      expect(
        count(args, "--static-analysis") - count(given, "--static-analysis"),
      ).toBe(0);
    });
  });
});
