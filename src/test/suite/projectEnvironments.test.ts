import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigurationChangeEvent,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
} from "vscode";
import type { ToolEnvironment } from "../../fusion/toolEnvironment";
import { ProjectEnvironments } from "../../projects/projectEnvironments";
import { CONFIGURATION_SECTION } from "../../settings";
import { flushAsync } from "../async";
import { createdFileSystemWatchers } from "../mock/vscode";
import { declaredProject } from "../projectHarness";

const folder: WorkspaceFolder = {
  uri: Uri.file("/ws"),
  name: "ws",
  index: 0,
};
const host = { PATH: "/usr/bin" };
const resolved = (overlay: Record<string, string | null>): ToolEnvironment => ({
  kind: "resolved",
  manager: "mise",
  overlay,
});

describe("ProjectEnvironments", () => {
  let setting: string;
  let trusted: boolean;
  let configListener: ((event: ConfigurationChangeEvent) => void) | undefined;
  let trustListener: (() => void) | undefined;
  let results: Record<string, ToolEnvironment>;
  let resolve: ReturnType<
    typeof vi.fn<
      (root: string, host: Record<string, string>) => Promise<ToolEnvironment>
    >
  >;
  let logs: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
  let environments: ProjectEnvironments;

  const a = declaredProject("a", "/ws/a", folder);
  const b = declaredProject("b", "/ws/b", folder);

  beforeEach(() => {
    setting = "auto";
    trusted = true;
    results = {
      "/ws/a": resolved({ A: "1" }),
      "/ws/b": resolved({ B: "1" }),
    };
    resolve = vi.fn(async (root: string) => results[root] ?? { kind: "none" });
    logs = { warn: vi.fn(), info: vi.fn() };
    createdFileSystemWatchers.length = 0;
    Object.assign(workspace, { workspaceFolders: [folder] });
    vi.spyOn(workspace, "isTrusted", "get").mockImplementation(() => trusted);
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: vi.fn(() => setting),
    } as any);
    vi.spyOn(workspace, "onDidChangeConfiguration").mockImplementation(
      (listener) => {
        configListener = listener as typeof configListener;
        return { dispose: vi.fn() };
      },
    );
    vi.spyOn(workspace, "onDidGrantWorkspaceTrust").mockImplementation(
      (listener) => {
        trustListener = listener as () => void;
        return { dispose: vi.fn() };
      },
    );
    vi.mocked(window.showWarningMessage).mockClear();
    environments = new ProjectEnvironments(
      () => logs as any,
      resolve,
      () => host,
    );
  });

  afterEach(() => {
    environments.dispose();
    vi.restoreAllMocks();
  });

  const changes = () => {
    const fired = vi.fn();
    environments.onDidChange(fired);
    return fired;
  };

  /** Writes `results` for `root` and delivers a watcher event for `file`, as the watcher of `pattern` would. */
  const touch = async (watcher: number, file: string) => {
    createdFileSystemWatchers[watcher].fire("change", file);
    await flushAsync();
  };

  it("applies the overlay to the host environment and names the manager", async () => {
    const environment = await environments.ensure(a);

    expect(environment.env).toEqual({ ...host, A: "1" });
    expect(environment.source).toBe("mise");
    expect(resolve).toHaveBeenCalledWith("/ws/a", host);
  });

  it("caches the result and shares one in-flight probe per root", async () => {
    const [first, second] = await Promise.all([
      environments.ensure(a),
      environments.ensure(a),
    ]);
    const third = await environments.ensure(a);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(environments.peek(a)).toBe(first);
    expect(environments.peek(b)).toBeUndefined();
  });

  it("skips the probe and uses the host env in an untrusted workspace", async () => {
    trusted = false;

    const environment = await environments.ensure(a);

    expect(resolve).not.toHaveBeenCalled();
    expect(environment.env).toEqual(host);
    expect(environment.source).toBe("host");
  });

  it("probes and fires onDidChange when trust is granted", async () => {
    trusted = false;
    await environments.ensure(a);
    const fired = changes();

    trusted = true;
    trustListener?.();
    await flushAsync();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(environments.peek(a)?.env).toEqual({ ...host, A: "1" });
    expect(fired).toHaveBeenCalledWith(a);
  });

  it("skips the probe when the setting is off, and probes again when it changes", async () => {
    setting = "off";
    await environments.ensure(a);
    expect(resolve).not.toHaveBeenCalled();
    const fired = changes();

    setting = "auto";
    configListener?.({
      affectsConfiguration: (section, scope) =>
        section === `${CONFIGURATION_SECTION}.toolEnvironment` &&
        (scope as Uri | undefined)?.fsPath === a.root.fsPath,
    });
    await flushAsync();

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith(a);
  });

  it("watches each folder with the two patterns", () => {
    expect(
      createdFileSystemWatchers.map(
        (watcher) => (watcher.pattern as any).pattern,
      ),
    ).toEqual([
      "**/{mise.toml,.mise.toml,mise.local.toml,.mise.local.toml,.tool-versions,.envrc}",
      "**/.config/mise/config.toml",
    ]);
  });

  it("re-resolves only the projects at or below the governed directory", async () => {
    await environments.ensure(a);
    await environments.ensure(b);
    resolve.mockClear();
    results["/ws/a"] = resolved({ A: "2" });
    const fired = changes();

    await touch(0, "/ws/a/mise.toml");

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("/ws/a", host);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired).toHaveBeenCalledWith(a);
    expect(environments.peek(a)?.env.A).toBe("2");
  });

  it("re-resolves projects below a file at the folder root", async () => {
    await environments.ensure(a);
    await environments.ensure(b);
    resolve.mockClear();

    await touch(0, "/ws/.envrc");

    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("governs the parent of .config for a mise config file", async () => {
    await environments.ensure(a);
    await environments.ensure(b);
    resolve.mockClear();

    await touch(1, "/ws/a/.config/mise/config.toml");

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("/ws/a", host);
  });

  it("fires onDidChange only when the environment changed", async () => {
    await environments.ensure(a);
    const fired = changes();

    await touch(0, "/ws/a/mise.toml");
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(fired).not.toHaveBeenCalled();

    results["/ws/a"] = resolved({ A: null });
    await touch(0, "/ws/a/mise.toml");
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it("falls back to the host env and logs one line when the probe fails", async () => {
    results["/ws/a"] = { kind: "failed", manager: "mise", detail: "boom" };

    const environment = await environments.ensure(a);

    expect(environment.env).toEqual(host);
    expect(environment.source).toBe("host");
    expect(logs.warn).toHaveBeenCalledTimes(1);
    expect(window.showWarningMessage).not.toHaveBeenCalled();
  });

  it("falls back to the host env when resolving throws", async () => {
    resolve.mockRejectedValueOnce(new Error("spawn failed"));

    const environment = await environments.ensure(a);

    expect(environment.env).toEqual(host);
    expect(logs.warn).toHaveBeenCalledTimes(1);
  });

  it("warns once per project and hint when the tool manager is untrusted", async () => {
    results["/ws/a"] = {
      kind: "untrusted",
      manager: "mise",
      hint: "Run mise trust",
      detail: "config is not trusted",
    };

    const environment = await environments.ensure(a);
    await touch(0, "/ws/a/mise.toml");
    await touch(0, "/ws/a/mise.toml");

    expect(environment.env).toEqual(host);
    expect(window.showWarningMessage).toHaveBeenCalledTimes(1);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      "a: Run mise trust",
      "Show output",
    );
  });

  it("reports an ignored project-dir variable in the log and detail, without a notification", async () => {
    results["/ws/a"] = resolved({ DBT_PROJECT_DIR: "/elsewhere" });
    const message =
      "DBT_PROJECT_DIR=/elsewhere is ignored for /ws/a: --project-dir takes precedence";

    const environment = await environments.ensure(a);
    await touch(0, "/ws/a/mise.toml");

    expect(environment.projectDirNotice).toBe(message);
    expect(logs.info).toHaveBeenCalledTimes(1);
    expect(logs.info).toHaveBeenCalledWith("projectEnvironment", message);
    expect(window.showWarningMessage).not.toHaveBeenCalled();
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it("has no notice when the variable names the root", async () => {
    results["/ws/a"] = resolved({ DBT_PROJECT_DIR: "/ws/a" });

    const environment = await environments.ensure(a);

    expect(environment.projectDirNotice).toBeUndefined();
    expect(logs.info).not.toHaveBeenCalled();
  });
});
