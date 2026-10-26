import { spawnSync } from "node:child_process";
import { readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { listLogs } from "./launchSupport.mjs";

// Mocha's own timeout runs inside the extension host, so a blocked host never reports it.
const HOST_WATCHDOG_MS = Number(process.env.FPU_SMOKE_WATCHDOG_MS ?? 240_000);

/**
 * The `ps` lines of the host under test: on Linux, those under its install `bundle`; elsewhere, any line that names
 * Cursor, Code, dbt or Electron.
 */
export function hostProcessLines(psOutput, { platform, bundle }) {
  return psOutput
    .split("\n")
    .filter((line) =>
      platform === "linux"
        ? line.includes(bundle)
        : /Cursor|Code|dbt|Electron/.test(line),
    );
}

/**
 * The two busiest host processes, as `ps` fields (pid, ppid, pcpu, etime, command). Helper processes retitle
 * themselves, so a helper title counts as well as the bundle path.
 */
export function busiestProcesses(hostLines, bundle) {
  return hostLines
    .filter((line) =>
      line.includes(bundle) ? true : /(Cursor|Code) Helper/.test(line),
    )
    .map((line) => line.trim().split(/\s+/))
    .sort((a, b) => Number(b[2]) - Number(a[2]))
    .slice(0, 2);
}

/**
 * Arms the host watchdog. When the timeout passes, it writes the host's state and recent logs to stderr, samples the
 * busiest processes on macOS, runs `cleanup`, and exits 124. The timer is unreferenced, so it never keeps the runner
 * alive by itself; the caller clears it when the run finishes.
 */
export function armWatchdog({
  host,
  hostApp,
  diagnosticsDir,
  cleanup,
  timeoutMs = HOST_WATCHDOG_MS,
}) {
  const timer = setTimeout(() => {
    // Synchronous writes: process.exit discards pending async output on a piped stderr.
    const out = (text) => writeSync(2, `${text}\n`);
    out(`FPU_SMOKE_WATCHDOG: ${host} did not finish within ${timeoutMs} ms`);
    const ps = spawnSync("ps", ["-eo", "pid,ppid,pcpu,etime,command"], {
      encoding: "utf-8",
    });
    // On Linux the host lives in its install directory (e.g. .../usr/share/cursor), not a .app bundle.
    const bundle =
      process.platform === "linux"
        ? path.dirname(hostApp)
        : hostApp.slice(0, hostApp.indexOf(".app") + 4);
    const hostLines = hostProcessLines(ps.stdout, {
      platform: process.platform,
      bundle,
    });
    out(hostLines.join("\n"));
    const logs = listLogs(path.join(diagnosticsDir, "logs")).sort(
      (a, b) =>
        Number(/renderer|exthost\.log|Fusion|dbt/i.test(b)) -
        Number(/renderer|exthost\.log|Fusion|dbt/i.test(a)),
    );
    for (const file of logs) {
      const lines = readFileSync(file, "utf-8").split("\n");
      out(`FPU_SMOKE_LOG ${path.relative(diagnosticsDir, file)}`);
      out(lines.slice(-80).join("\n"));
    }
    // Native stacks of the busiest processes name a spinning loop.
    for (const [pid, , cpu] of process.platform === "darwin"
      ? busiestProcesses(hostLines, bundle)
      : []) {
      const sample = spawnSync("sample", [pid, "3"], { encoding: "utf-8" });
      out(`FPU_SMOKE_SAMPLE pid=${pid} cpu=${cpu}`);
      out(
        ([sample.stdout, sample.stderr].find(Boolean) ?? sample.stderr)
          .split("\n")
          .slice(0, 150)
          .join("\n"),
      );
    }
    cleanup();
    process.exit(124);
  }, timeoutMs);
  timer.unref();
  return timer;
}
