import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { anything, instance, mock, verify, when } from "ts-mockito";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Log } from "../../core/log";
import {
  CommandProcessExecution,
  CommandProcessExecutionFactory,
} from "../../fusion/commandProcessExecution";
import { ChannelLog } from "../../projects/outputChannels";

describe("CommandProcessExecution Tests", () => {
  let mockTerminal: Log;
  let factory: CommandProcessExecutionFactory;
  let testDir: string;

  beforeEach(() => {
    mockTerminal = mock(ChannelLog);
    when(mockTerminal.debug(anything(), anything(), anything())).thenReturn();
    factory = new CommandProcessExecutionFactory(instance(mockTerminal));
    testDir = path.join(
      os.tmpdir(),
      "test-dir-" + Math.random().toString(36).slice(2),
    );
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmdirSync(testDir);
    }
  });

  it("should execute command and return output", async () => {
    const execution = factory.createCommandProcessExecution({
      command: process.platform === "win32" ? "cmd" : "echo",
      args: process.platform === "win32" ? ["/c", "echo test"] : ["test"],
    });

    const result = await execution.complete();
    expect(result.stdout.trim()).toBe("test");
    expect(result.stderr).toBe("");
    verify(mockTerminal.debug(anything(), anything(), anything())).called();
  });

  it("should handle command errors", async () => {
    const execution = factory.createCommandProcessExecution({
      command: "nonexistentcommand",
    });

    await expect(execution.complete()).rejects.toThrow(
      /Command not found: "nonexistentcommand"/,
    );
  });

  it("should handle command with environment variables", async () => {
    const execution = factory.createCommandProcessExecution({
      command: process.platform === "win32" ? "cmd" : "printenv",
      args:
        process.platform === "win32" ? ["/c", "echo %TEST_VAR%"] : ["TEST_VAR"],
      envVars: { TEST_VAR: "test_value" },
    });

    const result = await execution.complete();
    expect(result.stdout.trim()).toBe("test_value");
  });

  it("should handle command with working directory", async () => {
    const execution = factory.createCommandProcessExecution({
      command: process.platform === "win32" ? "cmd" : "sh",
      args: process.platform === "win32" ? ["/c", "cd"] : ["-c", "pwd"],
      cwd: testDir,
    });

    const result = await execution.complete();
    const normalizedOutput = path.normalize(result.stdout.trim());
    const normalizedTestDir = path.normalize(testDir);
    expect(normalizedOutput.toLowerCase()).toContain(
      normalizedTestDir.toLowerCase(),
    );
  });

  it(
    "should handle command with stderr output",
    { timeout: 5000 },
    async () => {
      const execution = factory.createCommandProcessExecution({
        command: process.platform === "win32" ? "cmd" : "sh",
        args:
          process.platform === "win32"
            ? ["/c", "echo error 1>&2"]
            : ["-c", "echo error >&2"],
      });

      const result = await execution.complete();
      expect(result.stderr.trim()).toBe("error");
    },
  );

  it.skipIf(process.platform === "win32")(
    "streams stdout and stderr chunks in arrival order",
    async () => {
      const execution = factory.createCommandProcessExecution({
        command: "sh",
        args: [
          "-c",
          "echo one; sleep 0.1; echo two >&2; sleep 0.1; echo three",
        ],
      });
      const chunks: string[] = [];
      const result = await execution.complete({
        onOutput: (chunk) => chunks.push(chunk),
      });
      expect(chunks.join("")).toBe("one\ntwo\nthree\n");
      expect(chunks.join("")).toBe(result.fullOutput);
    },
  );

  it.skipIf(process.platform === "win32")(
    "returns the same result with or without onOutput",
    async () => {
      const run = (onOutput?: (chunk: string) => void) =>
        new CommandProcessExecution(instance(mockTerminal), "sh", [
          "-c",
          "printf 'a\\n\\nb'; printf 'err\\n' >&2; exit 3",
        ]).complete({ onOutput });
      const plain = await run();
      const streamed = await run(() => undefined);
      expect(streamed).toEqual(plain);
      expect(plain.exitCode).toBe(3);
      expect(plain.stdout).toBe("a\n\nb");
    },
  );

  it("rejects a missing command the same way when streaming", async () => {
    const execution = factory.createCommandProcessExecution({
      command: "nonexistentcommand",
    });
    await expect(
      execution.complete({ onOutput: () => undefined }),
    ).rejects.toThrow(/Command not found: "nonexistentcommand"/);
  });
});
