#!/usr/bin/env node
// Usage:
//   node scripts/quality/ratchet.mjs                 compare measured values with ceilings.json
//   node scripts/quality/ratchet.mjs --write         store the measured values in ceilings.json
//   node scripts/quality/ratchet.mjs compare --base <file> --messages <file>
//                                                    fail when ceilings.json loosens a key relative to <file>
//                                                    unless <messages> has a `Ratchet-Loosen: <key> <reason>` trailer
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

const tagCount = (tag) => () =>
  [
    "src",
    "packages/webview-contract/src",
    "packages/graph-layout/src",
    "webviews/src",
  ]
    .flatMap(productionFiles)
    .reduce(
      (total, file) =>
        total +
        (
          fs.readFileSync(file, "utf8").match(new RegExp(`@${tag}\\b`, "g")) ??
          []
        ).length,
      0,
    );

/** The Rust crates under crates/, each with a `rustSuppressions.<crate>` ceiling. */
export const RUST_CRATES = [
  "graph-layout",
  "graph-layout-napi",
  "graph-layout-wasm",
];

/** The start of an attribute: `#[` or `#![`. */
const ATTRIBUTE_START = /#!?\[/g;
/** A suppression call inside an attribute: `expect(` or `allow(`, directly or inside `cfg_attr(`. */
const SUPPRESSION_CALL = /\b(?:expect|allow)\s*\(/g;
/** A raw string opener (`r"`, `r#"`, `br##"`), matched at a position. */
const RAW_STRING = /b?r(#*)"/y;
/** A char literal (`'a'`, `'\n'`, `'\u{1F600}'`) matched at a position; a lifetime (`'a`) does not match. */
const CHAR_LITERAL = /'(?:\\[^']*|[^\\'\n])'/y;

/** The end of a raw string that starts at `i`, or -1 when no raw string starts there. */
function rawStringEnd(text, i) {
  if (/\w/.test(text[i - 1] ?? "")) {
    return -1;
  }
  RAW_STRING.lastIndex = i;
  const match = RAW_STRING.exec(text);
  if (!match) {
    return -1;
  }
  const close = `"${match[1]}`;
  const end = text.indexOf(close, i + match[0].length);
  return end === -1 ? text.length : end + close.length;
}

/**
 * Rust source with comments and string or char literals replaced by spaces (newlines kept), so a suppression quoted
 * in a comment or a string is not counted. A small tokenizer: nested block comments, raw strings and lifetimes are
 * handled; anything else is kept as written.
 */
export function blankRustNonCode(text) {
  const blank = (segment) => segment.replaceAll(/[^\n]/g, " ");
  let out = "";
  let i = 0;
  while (i < text.length) {
    let end = -1;
    if (text.startsWith("//", i)) {
      const newline = text.indexOf("\n", i);
      end = newline === -1 ? text.length : newline;
    } else if (text.startsWith("/*", i)) {
      let depth = 0;
      end = i;
      do {
        if (text.startsWith("/*", end)) {
          depth += 1;
          end += 2;
        } else if (text.startsWith("*/", end)) {
          depth -= 1;
          end += 2;
        } else {
          end += 1;
        }
      } while (depth > 0 && end < text.length);
    } else if (rawStringEnd(text, i) !== -1) {
      end = rawStringEnd(text, i);
    } else if (text[i] === '"') {
      end = i + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1;
      }
      end = Math.min(end + 1, text.length);
    } else if (text[i] === "'") {
      CHAR_LITERAL.lastIndex = i;
      const match = CHAR_LITERAL.exec(text);
      end = match ? i + match[0].length : -1;
    }
    if (end === -1) {
      out += text[i];
      i += 1;
    } else {
      out += blank(text.slice(i, end));
      i = end;
    }
  }
  return out;
}

/** The suppression calls in the attributes of one Rust file: `#[expect(..)]`, `#![allow(..)]`, `#[cfg_attr(.., expect(..))]`. */
export function countRustSuppressionsInText(text) {
  const code = blankRustNonCode(text);
  let total = 0;
  for (const start of code.matchAll(ATTRIBUTE_START)) {
    const open = start.index + start[0].length - 1;
    let depth = 0;
    let close = open;
    for (; close < code.length; close += 1) {
      if (code[close] === "[") {
        depth += 1;
      } else if (code[close] === "]") {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    total += [...code.slice(open, close).matchAll(SUPPRESSION_CALL)].length;
  }
  return total;
}

/** The suppression attributes in every `.rs` file under `srcDir`. */
export function countRustSuppressions(srcDir) {
  return fs
    .readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
    .map((entry) =>
      fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8"),
    )
    .reduce((total, text) => total + countRustSuppressionsInText(text), 0);
}

/**
 * Every ratcheted value. A `ceiling` may only fall and a `floor` may only rise. Values are stored and compared
 * at `precision` decimals; floors round down and ceilings round up.
 */
export const SUPPRESSION_FILES = {
  "suppressions.host": "eslint-suppressions.json",
  "suppressions.webview": "webviews/eslint-suppressions.json",
  "oxlintSuppressions.host": "oxlint-suppressions.json",
  "oxlintSuppressions.webview": "webviews/oxlint-suppressions.json",
};

export const METRICS = [
  ...Object.entries(SUPPRESSION_FILES).map(([key, file]) => ({
    key,
    kind: "ceiling",
    precision: 0,
    measure: () => suppressionTotal(file),
  })),
  ...RUST_CRATES.map((crate) => ({
    key: `rustSuppressions.${crate}`,
    kind: "ceiling",
    precision: 0,
    measure: () =>
      ["src", "tests"]
        .map((dir) => path.join(root, "crates", crate, dir))
        .filter((dir) => fs.existsSync(dir))
        .reduce((total, dir) => total + countRustSuppressions(dir), 0),
  })),
  {
    key: "internalTags",
    kind: "ceiling",
    precision: 0,
    measure: tagCount("internal"),
  },
  {
    key: "plannedTags",
    kind: "ceiling",
    precision: 0,
    measure: tagCount("planned"),
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
