import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  carriesFlag,
  CliCommand,
  commandParamsFor,
  toCliArgs,
  toCliEnvironment,
} from "../../core/cli";
import {
  DBT_LSP_USE_TARGET_LSP,
  LspRun,
  sameLspLaunch,
  toLspArgs,
  toLspLaunch,
} from "../../core/lsp";
import { ProjectSnapshot, resolveProjectSnapshot } from "../../core/project";
import { NUM_RUNS, relativeDir, segment } from "../arbitraries";
import { snapshotInputs } from "../arbitraries/projectSnapshot";

const snapshots = snapshotInputs.map(resolveProjectSnapshot);

const commands: fc.Arbitrary<CliCommand> = fc.oneof(
  segment.map((select): CliCommand => ({ kind: "run", select })),
  fc
    .option(segment, { nil: undefined })
    .map((select): CliCommand => ({ kind: "build", select })),
  segment.map((select): CliCommand => ({ kind: "test", select })),
  segment.map((select): CliCommand => ({ kind: "compile", select })),
  fc.constantFrom<CliCommand>(
    { kind: "parse" },
    { kind: "deps" },
    { kind: "clean" },
    { kind: "debug" },
  ),
);

const runs: fc.Arbitrary<LspRun> = fc.record({
  port: fc.integer({ min: 1, max: 65535 }),
  commandPrefix: segment.map((s) => `fusionPowerUser:${s}:`),
  projectDir: relativeDir.map((d) => `/${d}`),
});

const valueOf = (args: readonly string[], flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};

const cliArgs = (s: ProjectSnapshot, c: CliCommand) =>
  toCliArgs(s, c, () => "missing");

type Invocation = ProjectSnapshot["invocation"];

const withInvocation = (
  s: ProjectSnapshot,
  change: Partial<Invocation>,
): ProjectSnapshot => ({ ...s, invocation: { ...s.invocation, ...change } });

/** One change to each restart field, each guaranteed to alter the launch. */
const restartChanges: [string, (s: ProjectSnapshot) => ProjectSnapshot][] = [
  [
    "executable",
    (s) =>
      withInvocation(s, {
        executable:
          s.invocation.executable.source === "path"
            ? { source: "configured", path: "/opt/dbt" }
            : { source: "path" },
      }),
  ],
  ["root", (s) => ({ ...s, root: `${s.root}/other` })],
  [
    "target",
    (s) => withInvocation(s, { target: `${s.invocation.target ?? ""}x` }),
  ],
  [
    "profile",
    (s) => withInvocation(s, { profile: `${s.invocation.profile ?? ""}x` }),
  ],
  [
    "profilesDir",
    (s) =>
      withInvocation(s, {
        profilesDir: `${s.invocation.profilesDir ?? ""}/p`,
      }),
  ],
  [
    "staticAnalysis",
    (s) =>
      withInvocation(s, {
        staticAnalysis:
          s.invocation.staticAnalysis === "strict" ? "off" : "strict",
      }),
  ],
  [
    "lintEnabled",
    (s) =>
      withInvocation(s, {
        lsp: {
          ...s.invocation.lsp,
          lintEnabled: !s.invocation.lsp.lintEnabled,
        },
      }),
  ],
  [
    "traceServer",
    (s) =>
      withInvocation(s, {
        lsp: {
          ...s.invocation.lsp,
          traceServer:
            s.invocation.lsp.traceServer === "verbose" ? "messages" : "verbose",
        },
      }),
  ],
  [
    "environment",
    (s) =>
      withInvocation(s, {
        environment: {
          ...s.invocation.environment,
          HOME: `${s.invocation.environment.HOME ?? ""}x`,
        },
      }),
  ],
  [
    "compiledOutput.mode",
    (s) =>
      withInvocation(s, {
        compiledOutput: {
          ...s.invocation.compiledOutput,
          mode:
            s.invocation.compiledOutput.mode === "separate"
              ? "shared"
              : "separate",
        },
      }),
  ],
];

describe("toLspLaunch parity with the CLI", () => {
  it("passes the same --target and --profiles-dir as the CLI when the params do not set them", () => {
    fc.assert(
      fc.property(snapshots, commands, runs, (s, c, run) => {
        const params = commandParamsFor(s, c);
        const cli = cliArgs(s, c);
        const lsp = toLspArgs(toLspLaunch(s), run);
        const flags: [string, string?][] = [
          ["--target", "-t"],
          ["--profiles-dir"],
        ];
        for (const [name, alias] of flags) {
          if (carriesFlag(params, name, alias)) {
            continue;
          }
          expect(valueOf(lsp, name)).toBe(valueOf(cli, name));
        }
        expect(valueOf(lsp, "--target")).toBe(s.invocation.target);
        expect(valueOf(lsp, "--profiles-dir")).toBe(s.invocation.profilesDir);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("launches in the snapshot root, the CLI's --project-dir", () => {
    fc.assert(
      fc.property(snapshots, commands, (s, c) => {
        const launch = toLspLaunch(s);
        expect(launch.projectDir).toBe(s.root);
        if (!carriesFlag(commandParamsFor(s, c), "--project-dir")) {
          expect(valueOf(cliArgs(s, c), "--project-dir")).toBe(s.root);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("inherits the CLI environment and sets DBT_LSP_USE_TARGET_LSP only for separate output", () => {
    fc.assert(
      fc.property(snapshots, (s) => {
        const lsp = toLspLaunch(s).environment;
        const cli = toCliEnvironment(s);
        const keys = new Set([...Object.keys(lsp), ...Object.keys(cli)]);
        keys.delete(DBT_LSP_USE_TARGET_LSP);
        for (const key of keys) {
          expect(lsp[key]).toBe(cli[key]);
        }
        expect(lsp[DBT_LSP_USE_TARGET_LSP]).toBe(
          s.invocation.compiledOutput.mode === "separate" ? "1" : undefined,
        );
        expect(DBT_LSP_USE_TARGET_LSP in lsp).toBe(
          s.invocation.compiledOutput.mode === "separate",
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("sameLspLaunch", () => {
  it.each(restartChanges)("restarts when %s changes", (_name, change) => {
    fc.assert(
      fc.property(snapshots, (s) => {
        expect(sameLspLaunch(toLspLaunch(s), toLspLaunch(change(s)))).toBe(
          false,
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("keeps the launch when only defer, command params, paths or name differ", () => {
    fc.assert(
      fc.property(snapshots, snapshots, (s, other) => {
        const next: ProjectSnapshot = {
          ...s,
          name: other.name,
          paths: other.paths,
          invocation: {
            ...s.invocation,
            defer: other.invocation.defer,
            commandParams: other.invocation.commandParams,
            compiledOutput: {
              ...s.invocation.compiledOutput,
              dir: other.invocation.compiledOutput.dir,
            },
          },
        };
        expect(sameLspLaunch(toLspLaunch(s), toLspLaunch(next))).toBe(true);
        expect(
          sameLspLaunch(toLspLaunch(s), toLspLaunch(structuredClone(s))),
        ).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("toLspArgs properties", () => {
  it("carries each flag once and never an empty argument", () => {
    fc.assert(
      fc.property(snapshots, runs, (s, run) => {
        const launch = toLspLaunch(s);
        const args = toLspArgs(launch, run);
        expect(args[0]).toBe("lsp");
        expect(args.every((a) => a.length > 0)).toBe(true);
        expect(valueOf(args, "--socket")).toBe(String(run.port));
        expect(valueOf(args, "--project-dir")).toBe(run.projectDir);
        expect(valueOf(args, "--command-prefix")).toBe(run.commandPrefix);
        expect(valueOf(args, "--lint-enabled")).toBe(
          String(launch.lintEnabled),
        );
        for (const flag of args.filter((a) => a.startsWith("--"))) {
          expect(args.filter((a) => a === flag)).toHaveLength(1);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("omits --static-analysis exactly when the mode is project", () => {
    fc.assert(
      fc.property(snapshots, runs, (s, run) => {
        const mode = s.invocation.staticAnalysis;
        expect(
          valueOf(toLspArgs(toLspLaunch(s), run), "--static-analysis"),
        ).toBe(mode === "project" ? undefined : mode);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("passes --log-level exactly when the trace level is not off", () => {
    const expected = { off: undefined, messages: "debug", verbose: "trace" };
    fc.assert(
      fc.property(snapshots, runs, (s, run) => {
        expect(valueOf(toLspArgs(toLspLaunch(s), run), "--log-level")).toBe(
          expected[s.invocation.lsp.traceServer],
        );
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
