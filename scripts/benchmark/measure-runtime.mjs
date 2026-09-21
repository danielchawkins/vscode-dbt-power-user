import { spawnSync } from "child_process";
import { createServer } from "net";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, index, argv) =>
      arg.startsWith("--") ? [[arg.slice(2), argv[index + 1]]] : [],
    ),
);
const host = args.host;
const vsix = args.vsix;
if (!["vscode", "cursor"].includes(host) || !vsix) {
  console.error(
    "usage: measure-runtime.mjs --host <vscode|cursor> --vsix PATH",
  );
  process.exit(2);
}

const compile = spawnSync("npm", ["run", "compile:integration"], {
  cwd: root,
  stdio: "inherit",
});
if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const samples = [];
let hostMetadata;
let runtime;
let activationMetadata;
let nextPort = 10_000 + (process.pid % 20_000);
for (let index = 0; index < 10; index += 1) {
  const port = await findAvailablePort(nextPort);
  nextPort = port + 1;
  const result = spawnSync(
    "bash",
    ["scripts/smoke/run-host-smoke.sh", "--host", host, "--vsix", vsix],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        FPU_CDP_PORT: String(port),
        FPU_RUNTIME_BENCHMARK: "1",
        FPU_SKIP_INTEGRATION_COMPILE: "1",
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  const match = result.stdout.match(/^FPU_RUNTIME_SAMPLE=(.+)$/m);
  if (!match) {
    process.stderr.write(result.stdout);
    throw new Error(`Runtime sample missing for ${host}`);
  }
  const sample = JSON.parse(match[1]);
  const currentActivationMetadata = {
    eager: sample.activation.eager,
    event: sample.activation.event,
    by: sample.activation.by,
  };
  activationMetadata ??= currentActivationMetadata;
  if (
    JSON.stringify(currentActivationMetadata) !==
    JSON.stringify(activationMetadata)
  ) {
    throw new Error(`Activation reason changed for ${host}`);
  }
  hostMetadata ??= readOutput(result.stdout, "FPU_HOST_METADATA");
  runtime ??= readOutput(result.stdout, "FPU_SMOKE_RUNTIME");
  if (index === 0) {
    console.log(`FPU_HOST_METADATA=${JSON.stringify(hostMetadata)}`);
    console.log(`FPU_SMOKE_RUNTIME=${JSON.stringify(runtime)}`);
  }
  samples.push(sample);
  console.log(
    `FPU_RUNTIME_RAW=${JSON.stringify({ index: index + 1, ...sample })}`,
  );
}

const viewPaths = ["/docs-generator", "/query-panel", "/lineage"];
const summary = {
  host,
  hostMetadata,
  runtime,
  activationMetadata,
  activation: Object.fromEntries(
    ["loadCode", "callActivate", "finishActivate"].map((phase) => [
      phase,
      summarize(samples.map((sample) => sample.activation[phase])),
    ]),
  ),
  webviews: Object.fromEntries(
    viewPaths.map((viewPath) => [
      viewPath,
      {
        firstContentfulPaint: summarize(
          samples.map(
            (sample) =>
              sample.webviews.find((webview) => webview.viewPath === viewPath)
                .firstContentfulPaint,
          ),
        ),
        resolveToReady: summarize(
          samples.map(
            (sample) =>
              sample.hostTimings.find((timing) => timing.viewPath === viewPath)
                .duration,
          ),
        ),
      },
    ]),
  ),
};
console.log(`FPU_RUNTIME_SUMMARY=${JSON.stringify(summary)}`);

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    raw: values,
    median: median(sorted),
    p90: percentile(sorted, 0.9),
  };
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(sorted, quantile) {
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)];
}

function readOutput(output, prefix) {
  const match = output.match(new RegExp(`^${prefix}=(.+)$`, "m"));
  if (!match) {
    throw new Error(`${prefix} missing for ${host}`);
  }
  return JSON.parse(match[1]);
}

async function findAvailablePort(start) {
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
