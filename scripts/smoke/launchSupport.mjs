import { createWriteStream, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { constants } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

/**
 * A file that records host output line by line, each line prefixed with the launcher's wall-clock time when the
 * line arrived. CI log timestamps cannot order events: a host's output can reach the runner in one batch at exit.
 */
export function createTimestampedLog(file) {
  const sink = createWriteStream(file, { flags: "a" });
  return {
    /** A stream that writes to `forward` unchanged and to the log with a timestamp on each line. */
    tee(forward) {
      let partial = "";
      return new Writable({
        write(chunk, _encoding, callback) {
          forward.write(chunk);
          const lines = (partial + chunk.toString()).split("\n");
          partial = lines.pop() ?? "";
          const stamp = new Date().toISOString();
          for (const line of lines) {
            sink.write(`${stamp} ${line}\n`);
          }
          callback();
        },
        final(callback) {
          if (partial) {
            sink.write(`${new Date().toISOString()} ${partial}\n`);
          }
          callback();
        },
      });
    },
  };
}

/** The shell exit status of a process that `signal` ended: 128 plus the signal's number. */
export function signalExitCode(signal) {
  const number = constants.signals[signal];
  if (number === undefined) {
    throw new RangeError(`Unknown signal ${signal}`);
  }
  return 128 + number;
}

/** Every `.log` file under `dir`, recursively; empty when `dir` does not exist. */
export function listLogs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const file = path.join(dir, entry);
    if (statSync(file).isDirectory()) {
      return listLogs(file);
    }
    return file.endsWith(".log") ? [file] : [];
  });
}

/** The first port from `start` that 127.0.0.1 can bind, below the ephemeral range. */
export async function findAvailablePort(start) {
  for (let port = start; port < 32_000; port += 1) {
    if (await canBind(port)) {
      return port;
    }
  }
  throw new Error("No CDP port available below the ephemeral range");
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
