// Copies probe output into the evidence folder. For warehouse-backed runs (`--scrub-rows`), every `dbt.show` row
// value becomes its JSON type, and document text sent in didOpen/didChange is dropped.
//   node collect.mjs <srcDir> <destDir> [--scrub-rows]
import fs from "node:fs";
import path from "node:path";

const [src, dest, flag] = process.argv.slice(2);
const scrubRows = flag === "--scrub-rows";
const typeOf = (v) => (v === null ? "null" : typeof v);
const scrub = (v, key) => {
  if (Array.isArray(v)) return v.map((x) => scrub(x));
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (k === "text" && typeof x === "string" && x.length > 200) out[k] = `<document text, ${x.length} chars>`;
      else if (scrubRows && k === "data" && Array.isArray(x) && x.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
        out[k] = x.map((r) => Object.fromEntries(Object.entries(r).map(([c, y]) => [c, `<${typeOf(y)}>`])));
      } else out[k] = scrub(x, k);
    }
    return out;
  }
  return v;
};
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(src)) {
  const from = path.join(src, name);
  if (fs.statSync(from).isDirectory()) continue;
  const to = path.join(dest, name);
  if (name.endsWith(".json")) {
    let value = scrub(JSON.parse(fs.readFileSync(from, "utf8")));
    // Benchmarked requests repeat five times with the same answer; keep the first of each label.
    if (name === "requests.json") {
      const seen = new Set();
      value = value.filter((e) => !seen.has(e.label) && seen.add(e.label));
    }
    fs.writeFileSync(to, JSON.stringify(value, null, 2) + "\n");
  } else fs.copyFileSync(from, to);
}
