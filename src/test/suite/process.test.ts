import { realpathSync } from "fs";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import { execFileText, spawnProcess } from "../../fusion/process";

const node = process.execPath;
const script = [
  "process.stdout.write(process.env.FPU_PROCESS_TEST ?? '');",
  "process.stderr.write(process.cwd());",
  "process.exitCode = Number(process.argv[1] ?? 0);",
].join("");

describe("execFileText", () => {
  it("does not interpret arguments through a shell", async () => {
    const { stdout } = await execFileText(
      node,
      ["-e", "process.stdout.write(process.argv[1])", "$HOME; echo x"],
      {},
    );
    expect(stdout).toBe("$HOME; echo x");
  });

  it("rejects with exit code and captured output on a non-zero exit", async () => {
    await expect(
      execFileText(node, ["-e", script, "3"], {
        env: { ...process.env, FPU_PROCESS_TEST: "out" },
      }),
    ).rejects.toMatchObject({ code: 3, stdout: "out", stderr: process.cwd() });
  });

  it("rejects with the errno code when the executable is missing", async () => {
    await expect(
      execFileText("fpu-missing-executable-for-test", [], {}),
    ).rejects.toMatchObject({ code: "ENOENT", stdout: "", stderr: "" });
  });
});

describe("spawnProcess", () => {
  it("pipes output and reports the exit code", async () => {
    const cwd = realpathSync(tmpdir());
    const child = spawnProcess(node, ["-e", script, "2"], {
      cwd,
      env: { ...process.env, FPU_PROCESS_TEST: "spawned" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exitCode = await new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "spawned",
      stderr: cwd,
      exitCode: 2,
    });
  });

  it("does not interpret arguments through a shell", async () => {
    const child = spawnProcess(
      node,
      ["-e", "process.stdout.write(process.argv[1])", "$HOME; echo x"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    await new Promise((resolve) => child.on("close", resolve));
    expect(stdout).toBe("$HOME; echo x");
  });

  it("reports the terminating signal after kill", async () => {
    const child = spawnProcess(node, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    const closed = new Promise<NodeJS.Signals | null>((resolve) =>
      child.on("close", (_code, signal) => resolve(signal)),
    );
    child.kill("SIGTERM");
    await expect(closed).resolves.toBe("SIGTERM");
  });
});
