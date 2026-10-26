import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  ProcessStreamBuffer,
  SpawnedLspProcess,
} from "../../fusion/lspProcess";
import type { ChildProcess } from "../../fusion/process";

describe("fusionLanguageClient helpers", () => {
  it("caps overlong partial lines by preserving the head", () => {
    const buffer = new ProcessStreamBuffer();
    const lines: string[] = [];
    const onLine = (line: string): void => {
      lines.push(line);
    };

    // PARTIAL_LINE_LIMIT in lspProcess.ts is 4096.
    buffer.feed("a".repeat(4_096 + 50), onLine);
    expect(lines).toHaveLength(0);
    buffer.flush(onLine);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("a".repeat(4_096));
  });
});

describe("SpawnedLspProcess streams", () => {
  function makeChildProcess(): ChildProcess {
    const child = new EventEmitter() as ChildProcess;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = null;
    return child;
  }

  it("keeps stderr in getStderr when stdout is verbose", () => {
    const child = makeChildProcess();
    const channelLines: string[] = [];
    const adapter = new SpawnedLspProcess(child, (line) => {
      channelLines.push(line);
    });

    const stdout = child.stdout as PassThrough;
    const stderr = child.stderr as PassThrough;
    for (let i = 0; i < 200; i += 1) {
      stdout.write(`stdout line ${i}\n`);
    }
    stderr.write("fatal: connection refused\n");

    expect(adapter.getStderr()).toContain("fatal: connection refused");
    expect(
      channelLines.some((line) => line.includes("fatal: connection refused")),
    ).toBe(true);
    expect(channelLines.some((line) => line.startsWith("stdout line"))).toBe(
      true,
    );
  });

  it("flushes partial lines on close after late stdio chunks", () => {
    const child = makeChildProcess();
    const channelLines: string[] = [];
    const adapter = new SpawnedLspProcess(child, (line) => {
      channelLines.push(line);
    });

    const stderr = child.stderr as PassThrough;
    stderr.write("late error without newline");
    child.emit("close");

    expect(adapter.getStderr()).toContain("late error without newline");
    expect(channelLines).toContain("late error without newline");
  });
});
