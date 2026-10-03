// Prints results.json as Markdown tables: median and [min–max] over the runs.
import { readFileSync } from "node:fs";

const r = JSON.parse(readFileSync(new URL("./out/results.json", import.meta.url), "utf8"));
const cell = (m) => (m?.median == null ? "—" : `${m.median} (${m.range[0]}–${m.range[1]})`);
console.log(`browser: ${r.browser.version}; WebGL: ${r.browser.webgl}`);
console.log("");
console.log("| Candidate | Graph | Layout ms | FCP ms | Drawn ms | Pan frame p50 ms | Pan frame p95 ms | Pan work p50 ms | Pan work p95 ms | Ready |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [key, s] of Object.entries(r.summary)) {
  const [candidate, graph] = key.split("/");
  console.log(
    `| ${candidate} | ${graph} | ${cell(s.layoutMs)} | ${cell(s.fcpMs)} | ${cell(s.drawnMs)} | ${cell(s.panP50)} | ${cell(s.panP95)} | ${cell(s.workP50)} | ${cell(s.workP95)} | ${s.ready}/${s.runs}${s.panned ? "" : " no-pan"}${s.violations.length ? " CSP" : ""}${s.errors.length ? " ERR" : ""} |`,
  );
}
console.log("");
console.log("| Candidate | JS bytes | JS gzip | CSS bytes |");
console.log("| --- | --- | --- | --- |");
for (const [name, b] of Object.entries(r.bundles)) {
  console.log(`| ${name} | ${b.js} | ${b.jsGzip} | ${b.css} |`);
}
const shares = r.results.filter((x) => x.pan?.drawnShare !== undefined).map((x) => `${x.candidate}/${x.graph}=${x.pan.drawnShare}%`);
console.log("");
console.log(`non-background share of first-run screenshots: ${shares.join(", ")}`);
const counts = Object.entries(r.summary).map(([k, s]) => `${k}=${JSON.stringify(s.counts)}`);
console.log(`drawn counts: ${counts.join(" ")}`);
const errs = Object.entries(r.summary).filter(([, s]) => s.errors.length || s.violations.length);
console.log(`errors: ${JSON.stringify(errs.map(([k, s]) => [k, s.errors, s.violations]))}`);
const longTasks = r.results.map((x) => `${x.candidate}/${x.graph}#${x.run}:${x.longTasks.map((t) => t.ms).join("+")}`);
console.log(`long tasks: ${longTasks.join(" ")}`);
