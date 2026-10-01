import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventEmitter,
  LogOutputChannel,
  Uri,
  window,
  WorkspaceFolder,
} from "vscode";
import {
  ChannelLog,
  DIAGNOSTICS_CHANNEL_NAME,
  EXTENSION_CHANNEL_NAME,
  OutputChannels,
} from "../../projects/outputChannels";
import { DeclaredProject } from "../../projects/projectRegistry";

const folder: WorkspaceFolder = {
  uri: Uri.file("/workspace"),
  name: "workspace",
  index: 0,
};

function makeProject(name: string, root: string): DeclaredProject {
  return {
    root: Uri.file(root),
    name,
    folder,
    contains: () => false,
    dispose: () => {},
  };
}

function created(): LogOutputChannel[] {
  return vi
    .mocked(window.createOutputChannel)
    .mock.results.map((result) => result.value as LogOutputChannel);
}

function createdNamed(name: string): LogOutputChannel {
  const channel = created().find((c) => c.name === name);
  expect(channel, name).toBeDefined();
  return channel!;
}

class FakeRegistry {
  projects: DeclaredProject[] = [];
  private readonly changed = new EventEmitter<void>();
  readonly onDidChangeProjects = this.changed.event;

  set(projects: DeclaredProject[]): void {
    this.projects = projects;
    this.changed.fire();
  }
}

describe("ChannelLog", () => {
  let log: ChannelLog;
  let channel: LogOutputChannel;

  beforeEach(() => {
    vi.mocked(window.createOutputChannel).mockClear();
    log = new ChannelLog("Fusion Power User: general");
    channel = createdNamed("Fusion Power User: general");
  });

  it("creates one log channel with its name", () => {
    expect(window.createOutputChannel).toHaveBeenCalledTimes(1);
    expect(window.createOutputChannel).toHaveBeenCalledWith(
      "Fusion Power User: general",
      { log: true },
    );
    expect(log.name).toBe("Fusion Power User: general");
  });

  it("writes each level with its source and without ANSI codes", () => {
    log.log("\u001b[32mOK\u001b[0m created");
    log.trace("trace line");
    log.debug("src", "debug line", 1);
    log.info("src", "info line");
    log.warn("src", "warn line");
    log.error("src", "failed", new Error("boom"));
    log.error("src", "failed", undefined);

    expect(channel.info).toHaveBeenCalledWith("OK created");
    expect(channel.trace).toHaveBeenCalledWith("trace line");
    expect(channel.debug).toHaveBeenCalledWith("src: debug line", 1);
    expect(channel.info).toHaveBeenCalledWith("src: info line");
    expect(channel.warn).toHaveBeenCalledWith("src: warn line");
    expect(channel.error).toHaveBeenCalledWith("src: failed: boom");
    expect(channel.error).toHaveBeenCalledWith("src: failed");
  });

  it("drops writes through the log or its channel after dispose", () => {
    log.dispose();
    log.dispose();
    log.info("n", "late");
    log.error("n", "late", new Error("e"));
    log.channel.appendLine("late");
    log.channel.show(true);

    expect(channel.dispose).toHaveBeenCalledTimes(1);
    expect(channel.info).not.toHaveBeenCalled();
    expect(channel.error).not.toHaveBeenCalled();
    expect(channel.appendLine).not.toHaveBeenCalled();
    expect(channel.show).not.toHaveBeenCalled();
  });

  it("forwards show's column and preserveFocus", () => {
    log.channel.show(true);
    log.channel.show(undefined, true);
    log.channel.show(2, false);

    expect(vi.mocked(channel.show).mock.calls).toEqual([
      [true],
      [undefined, true],
      [2, false],
    ]);
  });

  it("forwards the channel's log level for LanguageClient tracing", () => {
    expect(log.channel.logLevel).toBe(channel.logLevel);
    expect(log.channel.onDidChangeLogLevel).toBe(channel.onDidChangeLogLevel);
  });
});

describe("OutputChannels", () => {
  let outputs: OutputChannels;
  let registry: FakeRegistry;
  const general = makeProject("general", "/workspace/general");
  const sox = makeProject("sox", "/workspace/sox");

  beforeEach(() => {
    vi.mocked(window.createOutputChannel).mockClear();
    registry = new FakeRegistry();
    outputs = new OutputChannels();
    outputs.follow(registry);
  });

  afterEach(() => {
    outputs.dispose();
  });

  it("is the extension log and creates no project channel up front", () => {
    expect(outputs.name).toBe(EXTENSION_CHANNEL_NAME);
    expect(created().map((c) => c.name)).toEqual([EXTENSION_CHANNEL_NAME]);
  });

  it("creates one channel per Declared Project, keyed by the Declared Project", () => {
    registry.set([general, sox]);
    const first = outputs.projectLog(general);

    expect(outputs.projectLog(general)).toBe(first);
    expect(outputs.projectLog(sox)).not.toBe(first);
    expect(first.name).toBe("Fusion Power User: general");
    expect(outputs.logFor(general.root)).toBe(first);
    expect(outputs.logFor(Uri.file("/elsewhere"))).toBe(outputs);
    expect(created().map((c) => c.name)).toEqual([
      EXTENSION_CHANNEL_NAME,
      "Fusion Power User: general",
      "Fusion Power User: sox",
    ]);
  });

  it("adds the root digest when two Declared Projects share a name", () => {
    const twin = makeProject("general", "/workspace/other/general");
    registry.set([general, twin]);

    const names = [outputs.projectLog(general), outputs.projectLog(twin)].map(
      (log) => log.name,
    );

    expect(names[0]).toMatch(/^Fusion Power User: general \(.+\)$/);
    expect(names[1]).toMatch(/^Fusion Power User: general \(.+\)$/);
    expect(names[0]).not.toBe(names[1]);
  });

  it("keeps an existing channel's name when a same-named Declared Project joins later", () => {
    registry.set([general]);
    const first = outputs.projectLog(general);
    const twin = makeProject("general", "/workspace/other/general");
    registry.set([general, twin]);

    expect(first.name).toBe("Fusion Power User: general");
    expect(outputs.projectLog(twin).name).toMatch(
      /^Fusion Power User: general \(.+\)$/,
    );
  });

  it("disposes a project's channel when its Declared Project is removed", () => {
    registry.set([general, sox]);
    outputs.projectLog(general);
    outputs.projectLog(sox);

    registry.set([sox]);

    expect(
      createdNamed("Fusion Power User: general").dispose,
    ).toHaveBeenCalledTimes(1);
    expect(
      createdNamed("Fusion Power User: sox").dispose,
    ).not.toHaveBeenCalled();
    expect(outputs.logFor(general.root)).toBe(outputs);
  });

  it("replaces the channel when another Declared Project takes the same root", () => {
    registry.set([general]);
    const first = outputs.projectLog(general);
    const renamed = makeProject("renamed", "/workspace/general");
    registry.set([renamed]);

    const second = outputs.projectLog(renamed);

    expect(second).not.toBe(first);
    expect(second.name).toBe("Fusion Power User: renamed");
    expect(
      createdNamed("Fusion Power User: general").dispose,
    ).toHaveBeenCalledTimes(1);
  });

  it("disposes every channel once and creates none afterwards", () => {
    registry.set([general]);
    outputs.projectLog(general);

    outputs.dispose();
    outputs.dispose();
    const late = outputs.projectLog(sox);

    expect(late).toBe(outputs);
    for (const channel of created()) {
      expect(channel.dispose).toHaveBeenCalledTimes(1);
    }
    expect(created()).toHaveLength(2);
  });

  it("creates the diagnostics report channel for its caller", () => {
    const diagnostics = outputs.createDiagnosticsChannel();

    expect(window.createOutputChannel).toHaveBeenLastCalledWith(
      DIAGNOSTICS_CHANNEL_NAME,
      "log",
    );
    outputs.dispose();
    expect(diagnostics.dispose).not.toHaveBeenCalled();
  });
});
