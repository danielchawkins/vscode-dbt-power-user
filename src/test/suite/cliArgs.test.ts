import { mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CliCommand,
  deferState,
  PathKind,
  PathProbe,
  toCliArgs,
} from "../../core/cli";
import {
  DeferSettingsEntry,
  ProjectSnapshotSettings,
  resolveProjectSnapshot,
} from "../../core/project";
import { noSettings, snapshotFolder } from "../arbitraries/projectSnapshot";

const root = path.join(snapshotFolder, "proj");
const P = `--project-dir ${root}`;
const THREADS = "--threads 4";
const NO_DEFER = "--no-defer";
const DEFER_ON = "--defer --state /state --favor-state";

const plainParams: Partial<ProjectSnapshotSettings> = {
  runParams: ["--threads", "4"],
  buildParams: ["--fail-fast"],
  testParams: ["--indirect-selection", "cautious"],
};

/** Every path reads as `kind`. */
const every =
  (kind: PathKind): PathProbe =>
  () =>
    kind;

/** Reads the real disk, as the caller does. */
const diskProbe: PathProbe = (p) => {
  try {
    const stats = statSync(p);
    return stats.isDirectory()
      ? "directory"
      : stats.isFile()
        ? "file"
        : "missing";
  } catch {
    return "missing";
  }
};

interface Golden {
  settings?: Partial<ProjectSnapshotSettings>;
  defer?: DeferSettingsEntry;
  probe?: PathKind;
}

const deferEntry = (
  manifestPathForDeferral: string | undefined,
  deferToProduction = true,
  favorState = true,
): DeferSettingsEntry => ({
  deferToProduction,
  favorState,
  manifestPathForDeferral,
});

const SQL = "select 1";
const argv = (text: string) => text.split(" ");
/**
 * Exact argv for one command, snapshot and probed path kind. A string is split on spaces, so it may hold only flags
 * and values without spaces; a value that may contain one (the SQL) is its own array element.
 */
const golden: [string, CliCommand, string | string[], Golden?][] = [
  // Body, then command params, then snapshot flags.
  [
    "run +a+",
    { kind: "run", select: "+a+" },
    `run --select +a+ ${THREADS} ${P} ${NO_DEFER}`,
  ],
  [
    "build a+",
    { kind: "build", select: "a+" },
    `build --select a+ --fail-fast ${P} ${NO_DEFER}`,
  ],
  [
    "build without a selection takes no params",
    { kind: "build" },
    `build ${P} ${NO_DEFER}`,
  ],
  [
    "run without a selection",
    { kind: "run" },
    `run ${THREADS} ${P} ${NO_DEFER}`,
  ],
  [
    "run full refresh",
    { kind: "run", select: "a", fullRefresh: true },
    `run --select a --full-refresh ${THREADS} ${P} ${NO_DEFER}`,
  ],
  [
    "build full refresh",
    { kind: "build", fullRefresh: true },
    `build --full-refresh ${P} ${NO_DEFER}`,
  ],
  [
    "test",
    { kind: "test" },
    `test --indirect-selection cautious ${P} ${NO_DEFER}`,
  ],
  ["compile", { kind: "compile" }, `compile ${P} ${NO_DEFER}`],
  [
    "test a",
    { kind: "test", select: "a" },
    `test --select a --indirect-selection cautious ${P} ${NO_DEFER}`,
  ],
  [
    "compile +a",
    { kind: "compile", select: "+a" },
    `compile --select +a ${P} ${NO_DEFER}`,
  ],
  [
    "inline json",
    { kind: "compileInline", sql: "select 1", output: "json" },
    [
      ...argv("compile --inline"),
      SQL,
      ...argv(`--output json --log-format json --log-level debug ${P}`),
    ],
  ],
  [
    "inline quiet",
    { kind: "compileInline", sql: "select 1", output: "quiet" },
    [...argv("compile --inline"), SQL, ...argv(`--quiet ${P}`)],
  ],
  [
    "show",
    { kind: "show", sql: "select 1", limit: 500 },
    [
      ...argv("show --log-level debug --inline"),
      SQL,
      ...argv(`--limit 500 --output json --log-format json ${P}`),
    ],
  ],
  ["parse", { kind: "parse" }, `parse --log-format json ${P}`],
  ["deps", { kind: "deps" }, `deps ${P}`],
  ["clean", { kind: "clean" }, `clean ${P}`],
  ["debug", { kind: "debug" }, `debug ${P}`],
  // Snapshot flags.
  [
    "profiles directory and target on every kind",
    { kind: "deps" },
    `deps --profiles-dir /p ${P} --target prod`,
    { settings: { profilesDir: "/p", target: "prod" } },
  ],
  [
    "a flag is left out when the command params carry it",
    { kind: "run", select: "a" },
    `run --select a --profiles-dir /already/set --target dev ${P} ${NO_DEFER}`,
    {
      settings: {
        profilesDir: "/p",
        target: "prod",
        runParams: ["--profiles-dir", "/already/set", "--target", "dev"],
      },
    },
  ],
  ...([["--target=dev"], ["-t", "dev"], ["-tdev"]] as string[][]).map(
    (runParams): [string, CliCommand, string, Golden] => [
      `${runParams.join(" ")} carries --target`,
      { kind: "run", select: "a" },
      `run --select a ${runParams.join(" ")} ${P} ${NO_DEFER}`,
      { settings: { target: "prod", runParams } },
    ],
  ),
  [
    "--profiles-dir= and --project-dir= carry the flag",
    { kind: "run", select: "a" },
    `run --select a --profiles-dir=/q --project-dir=/r ${NO_DEFER}`,
    {
      settings: {
        profilesDir: "/p",
        runParams: ["--profiles-dir=/q", "--project-dir=/r"],
      },
    },
  ],
  [
    "--target-path is not mistaken for --target",
    { kind: "run", select: "a" },
    `run --select a --target-path t ${P} --target prod ${NO_DEFER}`,
    { settings: { target: "prod", runParams: ["--target-path", "t"] } },
  ],
  // Defer.
  [
    "defer unset",
    { kind: "run", select: "a" },
    `run --select a ${P} ${NO_DEFER}`,
    { settings: { runParams: [] } },
  ],
  [
    "defer disabled",
    { kind: "run", select: "a" },
    `run --select a ${P} ${NO_DEFER}`,
    { settings: { runParams: [] }, defer: deferEntry("/state", false) },
  ],
  [
    "defer with the state directory and favor-state",
    { kind: "run", select: "a" },
    `run --select a ${P} ${DEFER_ON}`,
    { settings: { runParams: [] }, defer: deferEntry("/state") },
  ],
  [
    "defer without favor-state",
    { kind: "run", select: "a" },
    `run --select a ${P} --defer --state /state`,
    { settings: { runParams: [] }, defer: deferEntry("/state", true, false) },
  ],
  [
    "defer uses the directory of a manifest.json path",
    { kind: "run", select: "a" },
    `run --select a ${P} --defer --state /state`,
    {
      settings: { runParams: [] },
      defer: deferEntry("/state/manifest.json", true, false),
      probe: "file",
    },
  ],
  [
    "defer enabled without a path adds nothing",
    { kind: "run", select: "a" },
    `run --select a ${P}`,
    { settings: { runParams: [] }, defer: deferEntry(undefined, true, false) },
  ],
  [
    "defer at a missing path adds nothing",
    { kind: "run", select: "a" },
    `run --select a ${P}`,
    {
      settings: { runParams: [] },
      defer: deferEntry("/state/notes.txt"),
      probe: "missing",
    },
  ],
  [
    "defer at a file other than manifest.json adds nothing",
    { kind: "run", select: "a" },
    `run --select a ${P}`,
    {
      settings: { runParams: [] },
      defer: deferEntry("/state/notes.txt"),
      probe: "file",
    },
  ],
  [
    "defer flags follow the profiles directory on a queued kind",
    { kind: "compile", select: "+a" },
    `compile --select +a --profiles-dir /p ${P} ${DEFER_ON}`,
    {
      settings: { profilesDir: "/p" },
      defer: deferEntry("/state/manifest.json"),
      probe: "file",
    },
  ],
];

describe("toCliArgs golden examples", () => {
  it.each(golden)("%s", (_label, command, expected, options = {}) => {
    const { settings = {}, defer, probe = "directory" } = options;
    const snapshot = resolveProjectSnapshot({
      root,
      folder: snapshotFolder,
      firstWorkspaceFolder: snapshotFolder,
      userHome: "/home/u",
      environment: {},
      lspCompiledOutputOverride: undefined,
      settings: {
        ...noSettings,
        ...plainParams,
        ...settings,
        ...(defer && { deferPerProject: { proj: defer } }),
      },
      projectFile: { kind: "parsed", text: "", config: { name: "proj" } },
    });
    expect(toCliArgs(snapshot, command, every(probe))).toEqual(
      typeof expected === "string" ? argv(expected) : expected,
    );
  });
});

describe("deferState", () => {
  const enabled = (manifestPath: string) => ({
    deferToProduction: true,
    favorState: true,
    manifestPath,
  });
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fusion-defer-"));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is off when defer is unset or disabled, and unset without a path", () => {
    const probe = every("directory");
    expect(deferState(undefined, probe)).toEqual({ kind: "off" });
    expect(
      deferState({ ...enabled("/state"), deferToProduction: false }, probe),
    ).toEqual({ kind: "off" });
    expect(deferState(enabled(""), probe)).toEqual({ kind: "unset" });
  });

  it("does not probe the disk unless defer is enabled with a path", () => {
    const probe = () => {
      throw new Error("probed");
    };
    expect(deferState(undefined, probe)).toEqual({ kind: "off" });
    expect(deferState(enabled(""), probe)).toEqual({ kind: "unset" });
  });

  it("uses a directory as given and a manifest.json file's directory", () => {
    const dir = tempDir();
    const manifest = path.join(dir, "manifest.json");
    writeFileSync(manifest, "{}");
    const on = { kind: "on", stateDirectory: dir, favorState: true };
    expect(deferState(enabled(dir), diskProbe)).toEqual(on);
    expect(deferState(enabled(manifest), diskProbe)).toEqual(on);
  });

  it("is unusable, naming the path, when the path does not exist or is another file", () => {
    const missing = path.join(tmpdir(), "fusion-defer-missing-path-xyz");
    const notManifest = path.join(tempDir(), "notes.txt");
    writeFileSync(notManifest, "hello");
    for (const manifestPath of [missing, notManifest]) {
      expect(deferState(enabled(manifestPath), diskProbe)).toEqual({
        kind: "unusable",
        manifestPath,
      });
    }
  });
});
