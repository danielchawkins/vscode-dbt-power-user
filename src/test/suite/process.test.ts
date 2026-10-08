import { realpathSync } from "fs";
import { tmpdir } from "os";
import { describe, expect, it } from "vitest";
import {
  execFileText,
  runProcessText,
  spawnProcess,
} from "../../fusion/process";

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

describe("runProcessText", () => {
  const cwd = realpathSync(tmpdir());

  it("resolves the output of a successful process", async () => {
    await expect(
      runProcessText(node, ["-e", "process.stdout.write('ok')"], {
        cwd,
        env: process.env,
        timeoutMs: 10_000,
      }),
    ).resolves.toEqual({ stdout: "ok", stderr: "" });
  });

  it("rejects with the exit code and output on a non-zero exit", async () => {
    await expect(
      runProcessText(node, ["-e", script, "4"], {
        cwd,
        env: { ...process.env, FPU_PROCESS_TEST: "out" },
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ code: 4, stdout: "out", stderr: cwd });
  });

  it("rejects with ETIMEDOUT when the process outlives the timeout", async () => {
    await expect(
      runProcessText(node, ["-e", "setInterval(() => {}, 1000)"], {
        cwd,
        env: process.env,
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({ code: "ETIMEDOUT", signal: "SIGTERM" });
  });

  it("rejects when output exceeds maxBuffer", async () => {
    await expect(
      runProcessText(
        node,
        [
          "-e",
          "process.stdout.write('x'.repeat(100)); setInterval(() => {}, 1000)",
        ],
        { cwd, env: process.env, timeoutMs: 10_000, maxBuffer: 10 },
      ),
    ).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
  });

  it("ignores stdin, so a reader sees end of input at once", async () => {
    await expect(
      runProcessText(
        node,
        [
          "-e",
          "process.stdin.on('data', () => {}).on('end', () => process.stdout.write('eof'))",
        ],
        { cwd, env: process.env, timeoutMs: 10_000 },
      ),
    ).resolves.toEqual({ stdout: "eof", stderr: "" });
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
