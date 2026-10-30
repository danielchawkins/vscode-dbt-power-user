#!/usr/bin/env node
// Writes the lineage engine comparison as one HTML page: a section per view, each engine's capture at full size in
// the same order, captioned with its measured crossings and hops. Reads the checkpoints `just smoke-engines` wrote.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ENGINES = ["balanced", "thorough"];
const root = path.resolve(process.argv[2] ?? "out/smoke-engines");

/** The subdirectories of `dir`, leaving out the diagnostics folder. */
const dirsIn = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "diagnostics")
    .map((d) => path.join(dir, d.name));

/** The engine checkpoints one `<host>/<fixture>` directory recorded. */
function checkpointsIn(fixtureDir) {
  const index = path.join(fixtureDir, "index.json");
  if (!existsSync(index)) {
    return [];
  }
  return JSON.parse(readFileSync(index, "utf8"))
    .filter(
      (entry) =>
        String(entry.name).startsWith("engines-") &&
        ENGINES.includes(entry.measured?.engine),
    )
    .map((entry) => ({
      host: path.basename(path.dirname(fixtureDir)),
      fixture: path.basename(fixtureDir),
      view: entry.measured.view,
      engine: entry.measured.engine,
      image: path.relative(root, path.join(fixtureDir, entry.image)),
      measured: entry.measured,
    }));
}

/** Every engine checkpoint under `root`: `<run>/<host>/<fixture>/index.json`, as `just smoke-engines` writes them. */
const checkpoints = () =>
  dirsIn(root).flatMap(dirsIn).flatMap(dirsIn).flatMap(checkpointsIn);

const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function figure(engine, capture) {
  if (!capture) {
    return `<figure><figcaption><b>${engine}</b> <span class=missing>not captured</span></figcaption></figure>`;
  }
  const { crossings, hops, edges } = capture.measured;
  return `<figure><figcaption><b>${engine}</b> · ${crossings} crossings · ${hops} hops · ${edges} edges</figcaption>
    <a href="${escape(capture.image)}"><img src="${escape(capture.image)}" loading="lazy"></a></figure>`;
}

const all = checkpoints();
if (all.length === 0) {
  console.error(`engine-sheet: no engine checkpoints under ${root}`);
  process.exit(1);
}
const rows = Map.groupBy(
  all,
  (c) => `${c.host}\u0000${c.fixture}\u0000${c.view}`,
);
const body = [...rows]
  .toSorted(([a], [b]) => a.localeCompare(b))
  .map(([key, captures]) => {
    const [host, fixture, view] = key.split("\u0000");
    const byEngine = new Map(captures.map((c) => [c.engine, c]));
    return `<section><h2>${escape(view)} <small>${escape(fixture)} · ${escape(host)}</small></h2>${ENGINES.map(
      (e) => figure(e, byEngine.get(e)),
    ).join("")}</section>`;
  })
  .join("\n");

const html = `<!doctype html><meta charset=utf-8><title>Lineage engines</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 16px auto; max-width: 1440px; }
  section { border-top: 2px solid #888; margin-top: 24px; }
  h2 small { font-weight: normal; color: #666; }
  figure { margin: 12px 0 20px; }
  figcaption { margin-bottom: 4px; }
  figure img { width: 100%; display: block; border: 1px solid #ccc; }
  .missing { color: #a00; }
</style>
${body}`;
const out = path.join(root, "engines.html");
writeFileSync(out, html);
console.log(`engine sheet: ${out} (${rows.size} views)`);
