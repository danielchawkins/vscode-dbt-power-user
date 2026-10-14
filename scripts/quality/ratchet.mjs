#!/usr/bin/env node
// Usage:
//   node scripts/quality/ratchet.mjs                 compare measured values with ceilings.json
//   node scripts/quality/ratchet.mjs --write         store the measured values in ceilings.json
//   node scripts/quality/ratchet.mjs compare --base <file> --messages <file>
//                                                    fail when ceilings.json loosens a key relative to <file>
//                                                    unless <messages> has a `Ratchet-Loosen: <key> <reason>` trailer
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const ceilingsPath = path.join(root, "scripts/quality/ceilings.json");

const suppressionTotal = (file) => {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  let total = 0;
  for (const rules of Object.values(baseline)) {
    for (const { count } of Object.values(rules)) {
      total += count;
    }
  }
  return total;
};

const isProductionSource = (file) =>
  /\.tsx?$/.test(file) &&
  !file.endsWith(".d.ts") &&
  !/\.test\.tsx?$/.test(file);

const productionFiles = (dir) =>
  fs
    .readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}test${path.sep}`))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
    .filter(isProductionSource);

const internalTagCount = () =>
  ["src", "packages/webview-contract/src", "webview_panels/src"]
    .flatMap(productionFiles)
    .reduce(
      (total, file) =>
        total +
        (fs.readFileSync(file, "utf8").match(/@internal\b/g) ?? []).length,
      0,
    );

/** Runs `command` and resolves with its exit status and combined output; a non-zero exit is data, not an error. */
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (status) =>
      resolve({ status, output: Buffer.concat(chunks).toString("utf8") }),
    );
  });

/** Counts `error TS<n>` in tsc output, plain or with the ANSI colour codes of pretty output. */
export const countTscErrors = (output) =>
  // oxlint-disable-next-line eslint/no-control-regex -- the ANSI colour codes start with ESC
  (output.replaceAll(/\u001b\[[\d;]*m/g, "").match(/error TS\d+/g) ?? [])
    .length;

// The TS 7 binary, not the TS 6 `typescript` alias.
const TSC7 = path.join(root, "node_modules/typescript-7/bin/tsc");
const TS_FLAG_PROJECTS = [
  "src/test/tsconfig.json",
  "packages/webview-contract/tsconfig.json",
  "webview_panels/tsconfig.test.json",
  "webview_panels/tsconfig.node.json",
];

// Both flags' runs share one contract build, so they never write its output at the same time.
let contractBuild;
const buildContract = () => {
  contractBuild ??= run(process.execPath, [
    TSC7,
    "-b",
    "packages/webview-contract",
  ]).then(({ status, output }) => {
    if (status !== 0) {
      throw new Error(`tsc -b packages/webview-contract failed:\n${output}`);
    }
  });
  return contractBuild;
};

/** TS 7 errors with `--<flag>` summed over the four projects; `tsconfig.integration.json` is not measured. */
export const tsFlagErrors = async (flag) => {
  await buildContract();
  const runs = await Promise.all(
    TS_FLAG_PROJECTS.map((project) =>
      run(process.execPath, [TSC7, "--noEmit", "-p", project, `--${flag}`]),
    ),
  );
  return runs.reduce((total, { output }) => total + countTscErrors(output), 0);
};

/**
 * Every ratcheted value. A `ceiling` may only fall and a `floor` may only rise. Values are stored and compared
 * at `precision` decimals; floors round down and ceilings round up.
 */
export const SUPPRESSION_FILES = {
  "suppressions.host": "eslint-suppressions.json",
  "suppressions.webview": "webview_panels/eslint-suppressions.json",
  "oxlintSuppressions.host": "oxlint-suppressions.json",
  "oxlintSuppressions.webview": "webview_panels/oxlint-suppressions.json",
};

export const METRICS = [
  ...Object.entries(SUPPRESSION_FILES).map(([key, file]) => ({
    key,
    kind: "ceiling",
    precision: 0,
    measure: () => suppressionTotal(file),
  })),
  {
    key: "internalTags",
    kind: "ceiling",
    precision: 0,
    measure: internalTagCount,
  },
  {
    key: "tsFlags.erasableSyntaxOnly",
    kind: "ceiling",
    precision: 0,
    measure: () => tsFlagErrors("erasableSyntaxOnly"),
  },
];

const round = (metric, value) => {
  const scale = 10 ** metric.precision;
  return metric.kind === "floor"
    ? Math.floor(value * scale) / scale
    : Math.ceil(value * scale) / scale;
};

/** Whether `value` is worse than `reference` for `metric`. */
const worseThan = (metric, value, reference) =>
  metric.kind === "ceiling" ? value > reference : value < reference;

/**
 * Compares measured values with the stored entries. A key that is worse, better or missing from `ceilings`
 * is reported; the ratchet passes only when every list is empty.
 */
export function compareMeasured(metrics, ceilings, measured) {
  const worse = [];
  const better = [];
  const missing = [];
  for (const metric of metrics) {
    const entry = ceilings[metric.key];
    const value = round(metric, measured[metric.key]);
    if (entry === undefined) {
      missing.push({ key: metric.key, value });
    } else if (worseThan(metric, value, entry)) {
      worse.push({ key: metric.key, value, entry });
    } else if (value !== entry) {
      better.push({ key: metric.key, value, entry });
    }
  }
  return { worse, better, missing };
}

/** `Ratchet-Loosen: <key> <reason>` trailers in commit messages, keyed by ratchet key. */
export function parseTrailers(messages) {
  const trailers = new Map();
  for (const match of messages.matchAll(
    /^Ratchet-Loosen:[ \t]*(\S+)[ \t]+(\S.*)$/gm,
  )) {
    trailers.set(match[1], match[2].trim());
  }
  return trailers;
}

/** Nested leaves keyed by dotted path, e.g. `coverage.host.lines`. */
function flatten(value, prefix = "") {
  return Object.entries(value)
    .flatMap(([name, leaf]) =>
      typeof leaf === "object" && leaf !== null
        ? Object.entries(flatten(leaf, `${prefix}${name}.`))
        : [[`${prefix}${name}`, leaf]],
    )
    .reduce((acc, [key, leaf]) => ({ ...acc, [key]: leaf }), {});
}

/** `coverage.*` floors may only rise; every other leaf (`size.*`, counts) may only fall. */
const defaultKind = (key) =>
  key.startsWith("coverage.") ? "floor" : "ceiling";

/**
 * Compares the pull request's ceilings with the base branch's. `base` is `undefined` when the base has no
 * ceilings.json. A key loosened or removed without a trailer is rejected; a key absent from the base is skipped.
 */
export function compareWithBase(metrics, rawBase, rawHead, messages) {
  const kinds = new Map(metrics.map((metric) => [metric.key, metric]));
  const base = rawBase && flatten(rawBase);
  const head = flatten(rawHead);
  const trailers = parseTrailers(messages);
  const result = { accepted: [], rejected: [], skipped: [] };
  if (base === undefined) {
    result.skipped = Object.keys(head);
    return result;
  }
  for (const key of Object.keys(head)) {
    const metric = kinds.get(key) ?? { kind: defaultKind(key) };
    if (base[key] === undefined) {
      result.skipped.push(key);
    } else if (worseThan(metric, head[key], base[key])) {
      classify(result, trailers, { key, from: base[key], to: head[key] });
    }
  }
  for (const key of Object.keys(base).filter(
    (key) => head[key] === undefined,
  )) {
    classify(result, trailers, { key, from: base[key], to: undefined });
  }
  return result;
}

function classify(result, trailers, change) {
  const reason = trailers.get(change.key);
  if (reason === undefined) {
    result.rejected.push(change);
  } else {
    result.accepted.push({ ...change, reason });
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** Replaces the ratcheted keys and keeps the entries other checks own (`coverage.*`, `size`). */
const writeCeilings = (values) => {
  const kept = fs.existsSync(ceilingsPath) ? readJson(ceilingsPath) : {};
  fs.writeFileSync(
    ceilingsPath,
    `${JSON.stringify({ ...kept, ...values }, null, 2)}\n`,
  );
};

async function measureAll() {
  const entries = await Promise.all(
    METRICS.map(async (metric) => [
      metric.key,
      round(metric, await metric.measure()),
    ]),
  );
  return Object.fromEntries(entries);
}

async function check(write) {
  const measured = await measureAll();
  if (write) {
    writeCeilings(measured);
    console.log(`wrote ${path.relative(root, ceilingsPath)}`);
    return 0;
  }
  const ceilings = fs.existsSync(ceilingsPath) ? readJson(ceilingsPath) : {};
  const { worse, better, missing } = compareMeasured(
    METRICS,
    ceilings,
    measured,
  );
  for (const { key, value, entry } of worse) {
    console.error(`${key}: measured ${value}, worse than ${entry}`);
  }
  for (const { key, value, entry } of better) {
    console.error(
      `${key}: measured ${value}, better than ${entry}; tighten with \`just lint-ratchet --write\``,
    );
  }
  for (const { key, value } of missing) {
    console.error(
      `${key}: measured ${value}, no entry; add it with \`just lint-ratchet --write\``,
    );
  }
  return worse.length + better.length + missing.length === 0 ? 0 : 1;
}

function compare(args) {
  const option = (name) => {
    const index = args.indexOf(name);
    if (index === -1 || args[index + 1] === undefined) {
      throw new Error(`compare needs ${name} <file>`);
    }
    return args[index + 1];
  };
  const basePath = option("--base");
  const base = fs.existsSync(basePath) ? readJson(basePath) : undefined;
  const messages = fs.readFileSync(option("--messages"), "utf8");
  const result = compareWithBase(
    METRICS,
    base,
    readJson(ceilingsPath),
    messages,
  );
  if (base === undefined) {
    console.log("base has no ceilings.json");
  }
  for (const key of result.skipped) {
    console.log(`skipped ${key}: not in the base`);
  }
  for (const { key, from, to, reason } of result.accepted) {
    console.log(
      `accepted ${key}: ${from} -> ${to ?? "removed"} (Ratchet-Loosen: ${reason})`,
    );
  }
  for (const { key, from, to } of result.rejected) {
    console.error(
      `rejected ${key}: ${from} -> ${to ?? "removed"}; add a \`Ratchet-Loosen: ${key} <reason>\` trailer`,
    );
  }
  return result.rejected.length === 0 ? 0 : 1;
}

async function main(args) {
  if (args[0] === "compare") {
    return compare(args.slice(1));
  }
  const unknown = args.filter((arg) => arg !== "--write");
  if (unknown.length > 0) {
    throw new Error(`unknown arguments: ${unknown.join(" ")}`);
  }
  return check(args.includes("--write"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
