import { describe, expect, it, vi } from "vitest";
import { flushAsync } from "../async";
import {
  makeExecutable,
  makeLaunch,
  makeLanguageClient,
  startClient,
  waitForState,
} from "../fusionClientHarness";

const DBT_LSP_USE_TARGET_LSP = "DBT_LSP_USE_TARGET_LSP";

describe("FusionLanguageClient lifecycle", () => {
  it("spawns directly without shell and passes the launch environment", async () => {
    const { client, spawnProcess } = startClient({
      options: {
        executable: makeExecutable({ env: { PROBE_ONLY: "1" } }),
        launch: makeLaunch({
          environment: {
            PATH: "/opt/bin",
            TEST_ENV: "1",
            [DBT_LSP_USE_TARGET_LSP]: "1",
          },
        }),
      },
    });

    await flushAsync();

    expect(spawnProcess).toHaveBeenCalledWith({
      executable: "/opt/dbt",
      args: expect.arrayContaining([
        "lsp",
        "--socket",
        "42424",
        "--project-dir",
        "/workspace/general",
        "--lint-enabled",
        "true",
      ]),
      env: {
        PATH: "/opt/bin",
        TEST_ENV: "1",
        DBT_LSP_USE_TARGET_LSP: "1",
      },
      cwd: "/workspace/general",
    });

    await client.stop();
    client.dispose();
  });

  it("layers options.env over the launch environment, except DBT_LSP_USE_TARGET_LSP", async () => {
    const { client, spawnProcess } = startClient({
      options: {
        env: { ORIGIN: "b", DBT_LSP_USE_TARGET_LSP: "0" },
        launch: makeLaunch({
          environment: {
            PATH: "/opt/bin",
            ORIGIN: "a",
            DBT_LSP_USE_TARGET_LSP: "1",
          },
        }),
      },
    });

    await flushAsync();

    expect(spawnProcess.mock.calls[0][0].env).toEqual({
      PATH: "/opt/bin",
      ORIGIN: "b",
      DBT_LSP_USE_TARGET_LSP: "1",
    });

    await client.stop();
    client.dispose();
  });

  it("uses launch.lintEnabled in launch args", async () => {
    const { client, spawnProcess } = startClient({
      options: { launch: makeLaunch({ lintEnabled: false }) },
    });

    await flushAsync();
    expect(spawnProcess).toHaveBeenCalled();
    const spawnSpec = spawnProcess.mock.calls[0]?.[0];
    expect(spawnSpec?.args).toEqual(
      expect.arrayContaining(["--lint-enabled", "false"]),
    );

    await client.stop();
    client.dispose();
  });

  it("cleans up when listen fails", async () => {
    const { client, spawnProcess } = startClient({
      deps: {
        listenForServer: async () => {
          throw new Error("listen failed");
        },
      },
    });

    await flushAsync();
    expect(client.state).toBe("failed");
    expect(spawnProcess).not.toHaveBeenCalled();

    await client.stop();
    client.dispose();
  });

  it("cleans up socket and process when spawn fails", async () => {
    const { client, server } = startClient({
      deps: {
        spawnProcess: vi.fn(() => {
          throw new Error("spawn failed");
        }),
      },
    });

    await flushAsync();
    expect(server.dispose).toHaveBeenCalled();
    expect(client.state).toBe("failed");

    await client.stop();
    client.dispose();
  });

  it("cleans up when start fails after transport setup", async () => {
    const languageClient = makeLanguageClient();
    languageClient.start.mockRejectedValue(new Error("start failed"));

    const { client, server } = startClient({ languageClient });

    await waitForState(client, "failed");
    expect(server.dispose).toHaveBeenCalled();
    expect(languageClient.stop).toHaveBeenCalled();
    expect(languageClient.dispose).toHaveBeenCalled();

    await client.stop();
    client.dispose();
  });

  it("disposes with SIGTERM then SIGKILL after grace", async () => {
    const { client, processAdapter } = startClient();

    await flushAsync();
    await client.stop();

    expect(processAdapter.kill).toHaveBeenCalledWith("SIGTERM");
    expect(processAdapter.kill).not.toHaveBeenCalledWith("SIGKILL");
    client.dispose();
  });
});
