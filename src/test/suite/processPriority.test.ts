import {
  chmodSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { constants, setPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnProcess } from "../../fusion/process";

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  setPriority: vi.fn(),
}));

const node = process.execPath;
const idleScript = "setInterval(() => {}, 1000)";
const printScript = "process.stdout.write('ran')";

/** Runs `command` with stdout captured; resolves once the child closes. */
async function captureStdout(
  command: string,
  args: string[],
  options: Parameters<typeof spawnProcess>[2],
): Promise<string> {
  const child = spawnProcess(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  await new Promise((resolve) => child.on("close", resolve));
  return stdout;
}

describe.skipIf(process.platform === "win32")(
  "spawnProcess background priority on POSIX",
  () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "fpu-nice-")));
  });

  it.fails("runs the command under nice -n 10, ahead of its arguments", async () => {
      // A stand-in `nice` that prints its argv instead of running the command.
      const nice = join(dir, "nice");
      writeFileSync(nice, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
      chmodSync(nice, 0o755);

      const stdout = await captureStdout(node, ["-e", printScript], {
        env: { ...process.env, PATH: dir },
        priority: "background",
      });

      expect(stdout).toBe(["-n", "10", node, "-e", printScript, ""].join("\n"));
  });

  it.fails(
    "falls back to normal priority with a debug line when nice is not on PATH",
    async () => {
      const debug = vi.fn();
      const stdout = await captureStdout(
        node,
        ["-e", printScript],
        {
          env: { ...process.env, PATH: dir },
          priority: "background",
          log: { debug },
        },
      );

      expect(stdout).toBe("ran");
      expect(debug).toHaveBeenCalledTimes(1);
      expect(debug.mock.calls[0]?.join(" ")).toContain("nice");
    },
  );
  },
);

describe("spawnProcess background priority on Windows", () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    vi.mocked(setPriority).mockClear();
    Object.defineProperty(process, "platform", { value: "win32" });
  });

  afterEach(() => {
    if (original) {
      Object.defineProperty(process, "platform", original);
    }
  });

  it.fails("lowers the child's priority with os.setPriority after spawn", () => {
    const child = spawnProcess(node, ["-e", idleScript], {
      stdio: "ignore",
      priority: "background",
    });
    try {
      expect(setPriority).toHaveBeenCalledWith(
        child.pid,
        constants.priority.PRIORITY_BELOW_NORMAL,
      );
    } finally {
      child.kill();
    }
  });
});
