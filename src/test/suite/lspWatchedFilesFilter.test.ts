import { beforeEach, describe, expect, it, vi } from "vitest";
import { Uri } from "vscode";
import { URI as VsCodeUri } from "vscode-uri";
import { canonicalProjectRoot } from "../../fusion/canonicalProjectRoot";
import { languageClientOptions } from "../../fusion/lspClientSupport";

/*
 * Characterization of "do not forward watched-file events the server ignores". `it.fails` states the behaviour the
 * refactor must deliver; flip it to `it` when it lands. The server registers every file, so the client forwards the
 * server's own writes under target/ and logs/, and those start no compile.
 */

function watchedHook(
  overrides: {
    root?: string;
    targetPath?: string;
    uriConverters?: unknown;
  } = {},
) {
  const root = overrides.root ?? "/w/p";
  const options = languageClientOptions({
    project: {
      folder: { uri: {}, name: "p", index: 0 },
      root: { fsPath: root },
    },
    targetPath: overrides.targetPath ?? `${root}/target`,
    selector: undefined,
    uriConverters: overrides.uriConverters,
    outputChannel: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    diagnosticsFilter: { shouldForward: () => true },
    config: { lintEnabled: false, maxErrorReporting: undefined },
  } as unknown as Parameters<typeof languageClientOptions>[0]);
  return options.middleware!.workspace!.didChangeWatchedFile! as unknown as (
    event: { uri: string; type: number },
    next: (event: unknown) => Promise<void>,
  ) => Promise<void>;
}

describe("watched-file forwarding", () => {
  beforeEach(() => {
    vi.mocked(Uri.parse).mockImplementation((value: string) =>
      VsCodeUri.parse(value),
    );
  });

  it("forwards a model change", async () => {
    const next = vi.fn(() => Promise.resolve());
    await watchedHook()({ uri: "file:///w/p/models/a.sql", type: 2 }, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("drops the server's own target/.lsp writes and log writes", async () => {
    const next = vi.fn(() => Promise.resolve());
    const hook = watchedHook();
    await hook(
      { uri: "file:///w/p/target/.lsp/compiled/p/models/a.sql", type: 2 },
      next,
    );
    await hook({ uri: "file:///w/p/target/manifest.json", type: 2 }, next);
    await hook({ uri: "file:///w/p/logs/dbt-lsp.log", type: 2 }, next);
    expect(next).not.toHaveBeenCalled();
  });

  // Fusion's launch root is the realpath of a symlinked project; the client's events arrive at that realpath.
  it("drops the server's writes when the project root is a symlink", async () => {
    const { uriConverters } = canonicalProjectRoot(
      "/w/link/p",
      () => "/w/real/p",
    );
    const next = vi.fn(() => Promise.resolve());
    const hook = watchedHook({
      root: "/w/link/p",
      targetPath: "/w/link/p/target",
      uriConverters,
    });
    await hook({ uri: "file:///w/real/p/target/manifest.json", type: 2 }, next);
    expect(next).not.toHaveBeenCalled();
  });
});
