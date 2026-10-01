import { mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  CliCommand,
  deferState,
  PathKind,
  PathProbe,
  toCliArgs,
} from "../../core/cli";
import {
  DeferSettingsEntry,
  ProjectSnapshot,
  ProjectSnapshotSettings,
  resolveProjectSnapshot,
} from "../../core/project";
import { noSettings, snapshotFolder } from "../arbitraries/projectSnapshot";

const root = path.join(snapshotFolder, "proj");
const projectDir = ["--project-dir", root];

function snapshot(
  settings: Partial<ProjectSnapshotSettings> = {},
): ProjectSnapshot {
  return resolveProjectSnapshot({
    root,
    folder: snapshotFolder,
    firstWorkspaceFolder: snapshotFolder,
    userHome: "/home/u",
    environment: {},
    lspCompiledOutputOverride: undefined,
    settings: { ...noSettings, ...settings },
    projectFile: { kind: "parsed", text: "", config: { name: "proj" } },
  });
}

const deferred = (
  entry: DeferSettingsEntry,
  settings: Partial<ProjectSnapshotSettings> = {},
) => snapshot({ ...settings, deferPerProject: { proj: entry } });

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

const args = (
  s: ProjectSnapshot,
  command: CliCommand,
  probe = every("directory"),
) => toCliArgs(s, command, probe);

describe("toCliArgs builds each kind's body, then command params, then snapshot flags", () => {
  const plain = snapshot({
    runParams: ["--threads", "4"],
    buildParams: ["--fail-fast"],
    testParams: ["--indirect-selection", "cautious"],
  });
  const cases: [CliCommand, string[]][] = [
    [
      { kind: "run", select: "+a+" },
      ["run", "--select", "+a+", "--threads", "4", ...projectDir, "--no-defer"],
    ],
    [
      { kind: "build", select: "a+" },
      ["build", "--select", "a+", "--fail-fast", ...projectDir, "--no-defer"],
    ],
    [{ kind: "build" }, ["build", ...projectDir, "--no-defer"]],
    [{ kind: "run" }, ["run", "--threads", "4", ...projectDir, "--no-defer"]],
    [
      { kind: "run", select: "a", fullRefresh: true },
      [
        "run",
        "--select",
        "a",
        "--full-refresh",
        "--threads",
        "4",
        ...projectDir,
        "--no-defer",
      ],
    ],
    [
      { kind: "build", fullRefresh: true },
      ["build", "--full-refresh", ...projectDir, "--no-defer"],
    ],
    [
      { kind: "test" },
      ["test", "--indirect-selection", "cautious", ...projectDir, "--no-defer"],
    ],
    [{ kind: "compile" }, ["compile", ...projectDir, "--no-defer"]],
    [
      { kind: "test", select: "a" },
      [
        "test",
        "--select",
        "a",
        "--indirect-selection",
        "cautious",
        ...projectDir,
        "--no-defer",
      ],
    ],
    [
      { kind: "compile", select: "+a" },
      ["compile", "--select", "+a", ...projectDir, "--no-defer"],
    ],
    [
      { kind: "compileNode", node: "a" },
      [
        "compile",
        "--select",
        "a",
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
        ...projectDir,
      ],
    ],
    [
      { kind: "compileInline", sql: "select 1", output: "json" },
      [
        "compile",
        "--inline",
        "select 1",
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
        ...projectDir,
      ],
    ],
    [
      { kind: "compileInline", sql: "select 1", output: "quiet" },
      ["compile", "--inline", "select 1", "--quiet", ...projectDir],
    ],
    [
      { kind: "show", sql: "select 1", limit: 500 },
      [
        "show",
        "--log-level",
        "debug",
        "--inline",
        "select 1",
        "--limit",
        "500",
        "--output",
        "json",
        "--log-format",
        "json",
        ...projectDir,
      ],
    ],
    [{ kind: "parse" }, ["parse", "--log-format", "json", ...projectDir]],
    [{ kind: "deps" }, ["deps", ...projectDir]],
    [{ kind: "clean" }, ["clean", ...projectDir]],
    [{ kind: "debug" }, ["debug", ...projectDir]],
  ];

  it.each(cases)("%j", (command, expected) => {
    expect(args(plain, command)).toEqual(expected);
  });
});

describe("toCliArgs snapshot flags", () => {
  it("passes the profiles directory and target on every kind", () => {
    const s = snapshot({ profilesDir: "/p", target: "prod" });
    expect(args(s, { kind: "deps" })).toEqual([
      "deps",
      "--profiles-dir",
      "/p",
      ...projectDir,
      "--target",
      "prod",
    ]);
  });

  it("leaves a flag out when the command params carry it", () => {
    const s = snapshot({
      profilesDir: "/p",
      target: "prod",
      runParams: ["--profiles-dir", "/already/set", "--target", "dev"],
    });
    expect(args(s, { kind: "run", select: "a" })).toEqual([
      "run",
      "--select",
      "a",
      "--profiles-dir",
      "/already/set",
      "--target",
      "dev",
      ...projectDir,
      "--no-defer",
    ]);
  });

  it.each([[["--target=dev"]], [["-t", "dev"]], [["-tdev"]]])(
    "treats %j as carrying --target",
    (runParams) => {
      const s = snapshot({ target: "prod", runParams });
      expect(args(s, { kind: "run", select: "a" })).not.toContain("--target");
    },
  );

  it("treats --profiles-dir= and --project-dir= as carrying the flag", () => {
    const s = snapshot({
      profilesDir: "/p",
      runParams: ["--profiles-dir=/q", "--project-dir=/r"],
    });
    expect(args(s, { kind: "run", select: "a" })).toEqual([
      "run",
      "--select",
      "a",
      "--profiles-dir=/q",
      "--project-dir=/r",
      "--no-defer",
    ]);
  });

  it("passes --target-path through without mistaking it for --target", () => {
    const s = snapshot({ target: "prod", runParams: ["--target-path", "t"] });
    expect(args(s, { kind: "run", select: "a" })).toContain("--target");
  });
});

describe("toCliArgs defer", () => {
  const run: CliCommand = { kind: "run", select: "a" };
  const tail = (s: ProjectSnapshot, probe = every("directory")) =>
    args(s, run, probe).slice(5);

  it("passes --no-defer when defer is unset or disabled", () => {
    expect(tail(snapshot())).toEqual(["--no-defer"]);
    expect(
      tail(
        deferred({
          deferToProduction: false,
          favorState: true,
          manifestPathForDeferral: "/state",
        }),
      ),
    ).toEqual(["--no-defer"]);
  });

  it("passes the state directory and favor-state", () => {
    expect(
      tail(
        deferred({
          deferToProduction: true,
          favorState: true,
          manifestPathForDeferral: "/state",
        }),
      ),
    ).toEqual(["--defer", "--state", "/state", "--favor-state"]);
  });

  it("omits --favor-state when it is not set", () => {
    expect(
      tail(
        deferred({
          deferToProduction: true,
          favorState: false,
          manifestPathForDeferral: "/state",
        }),
      ),
    ).toEqual(["--defer", "--state", "/state"]);
  });

  it("uses the directory of a manifest.json path", () => {
    expect(
      tail(
        deferred({
          deferToProduction: true,
          favorState: false,
          manifestPathForDeferral: "/state/manifest.json",
        }),
        every("file"),
      ),
    ).toEqual(["--defer", "--state", "/state"]);
  });

  it("adds nothing when defer is enabled without a path", () => {
    expect(
      tail(deferred({ deferToProduction: true, favorState: false })),
    ).toEqual([]);
  });

  it("adds nothing when the state path is missing or a file other than manifest.json", () => {
    const s = deferred({
      deferToProduction: true,
      favorState: true,
      manifestPathForDeferral: "/state/notes.txt",
    });
    expect(tail(s, every("missing"))).toEqual([]);
    expect(tail(s, every("file"))).toEqual([]);
  });

  it("puts defer flags after the profiles directory on a queued kind", () => {
    const s = deferred(
      {
        deferToProduction: true,
        favorState: true,
        manifestPathForDeferral: "/state/manifest.json",
      },
      { profilesDir: "/p" },
    );
    expect(args(s, { kind: "compile", select: "+a" }, every("file"))).toEqual([
      "compile",
      "--select",
      "+a",
      "--profiles-dir",
      "/p",
      ...projectDir,
      "--defer",
      "--state",
      "/state",
      "--favor-state",
    ]);
  });

  it("does not apply defer to deps, clean or inline compiles", () => {
    const s = snapshot();
    for (const command of [
      { kind: "deps" },
      { kind: "clean" },
      { kind: "compileInline", sql: "x", output: "json" },
    ] as CliCommand[]) {
      expect(args(s, command)).not.toContain("--no-defer");
    }
  });
});

describe("deferState", () => {
  const enabled = (manifestPath: string) => ({
    deferToProduction: true,
    favorState: true,
    manifestPath,
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
    const dir = mkdtempSync(path.join(tmpdir(), "fusion-defer-"));
    try {
      const manifest = path.join(dir, "manifest.json");
      writeFileSync(manifest, "{}");
      const on = { kind: "on", stateDirectory: dir, favorState: true };
      expect(deferState(enabled(dir), diskProbe)).toEqual(on);
      expect(deferState(enabled(manifest), diskProbe)).toEqual(on);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is unusable, naming the path, when the configured path does not exist", () => {
    const missing = path.join(tmpdir(), "fusion-defer-missing-path-xyz");
    expect(deferState(enabled(missing), diskProbe)).toEqual({
      kind: "unusable",
      manifestPath: missing,
    });
  });

  it("is unusable, naming the path, when the configured path is a file other than manifest.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fusion-defer-"));
    try {
      const notManifest = path.join(dir, "notes.txt");
      writeFileSync(notManifest, "hello");
      expect(deferState(enabled(notManifest), diskProbe)).toEqual({
        kind: "unusable",
        manifestPath: notManifest,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("toCliArgs with a profiles directory, params and each defer state", () => {
  const settings = {
    profilesDir: "/p",
    runParams: ["--threads", "4"],
    buildParams: ["--fail-fast"],
    testParams: ["--indirect-selection", "cautious"],
  };
  const flags = ["--profiles-dir", "/p", ...projectDir];
  const on = ["--defer", "--state", "/state", "--favor-state"];
  const bodies: [CliCommand, string[], boolean][] = [
    [
      { kind: "run", select: "+a" },
      ["run", "--select", "+a", "--threads", "4"],
      true,
    ],
    [
      { kind: "build", select: "+a" },
      ["build", "--select", "+a", "--fail-fast"],
      true,
    ],
    [{ kind: "build" }, ["build"], true],
    [
      { kind: "test", select: "a" },
      ["test", "--select", "a", "--indirect-selection", "cautious"],
      true,
    ],
    [{ kind: "compile", select: "+a" }, ["compile", "--select", "+a"], true],
    [
      { kind: "compileNode", node: "a" },
      [
        "compile",
        "--select",
        "a",
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ],
      false,
    ],
    [
      { kind: "compileInline", sql: "select 1", output: "json" },
      [
        "compile",
        "--inline",
        "select 1",
        "--output",
        "json",
        "--log-format",
        "json",
        "--log-level",
        "debug",
      ],
      false,
    ],
    [
      { kind: "show", sql: "select 1", limit: 500 },
      [
        "show",
        "--log-level",
        "debug",
        "--inline",
        "select 1",
        "--limit",
        "500",
        "--output",
        "json",
        "--log-format",
        "json",
      ],
      false,
    ],
    [{ kind: "parse" }, ["parse", "--log-format", "json"], false],
    [{ kind: "deps" }, ["deps"], false],
    [{ kind: "clean" }, ["clean"], false],
    [{ kind: "debug" }, ["debug"], false],
  ];

  it.each(bodies)("%j with defer off", (command, body, queued) => {
    expect(args(snapshot(settings), command)).toEqual([
      ...body,
      ...flags,
      ...(queued ? ["--no-defer"] : []),
    ]);
  });

  it.each(bodies)("%j with defer on", (command, body, queued) => {
    const s = deferred(
      {
        deferToProduction: true,
        favorState: true,
        manifestPathForDeferral: "/state",
      },
      settings,
    );
    expect(args(s, command)).toEqual([
      ...body,
      ...flags,
      ...(queued ? on : []),
    ]);
  });

  it.each(bodies)("%j with defer at a missing path", (command, body) => {
    const s = deferred(
      {
        deferToProduction: true,
        favorState: false,
        manifestPathForDeferral: "/state/missing",
      },
      settings,
    );
    expect(args(s, command, every("missing"))).toEqual([...body, ...flags]);
  });
});
