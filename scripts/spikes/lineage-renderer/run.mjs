// Serves each candidate page under the lineage panel's policy (`contentSecurityPolicy` in src/webview/panelHtml.ts,
// no per-panel allowances) and measures it in headless Chromium: layout time, first contentful paint and frame
// deltas while a real mouse drags the canvas. `node run.mjs [runs] [graphs]`.
import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const runs = Number(process.argv[2] ?? 3);
const graphs = (process.argv[3] ?? "p50,p95").split(",");
const candidates = (process.argv[4] ?? "incumbent,xyflow-elk,xyflow-dagre,cytoscape,sigma").split(",");
const query = process.argv[5] ? `&${process.argv[5]}` : "";
const dist = new URL("./dist/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const nonce = "bGluZWFnZXNwaWtl";

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(dist, path);
  try {
    let body = await readFile(file);
    if (file.endsWith(".html")) {
      const origin = `http://${req.headers.host}`;
      const policy = [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' ${origin}`,
        `style-src ${origin} 'unsafe-inline'`,
        `font-src ${origin}`,
        `img-src ${origin} data:`,
      ].join("; ");
      body = body
        .toString()
        .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`)
        .replace(/<script type="module" crossorigin/g, `<script nonce="${nonce}" type="module" crossorigin`);
    }
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] : null;
};
const round = (x) => (x == null ? null : Math.round(x * 10) / 10);

async function measure(browser, candidate, graph, run) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleLines = [];
  page.on("console", (m) => m.type() !== "log" && consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 240)));
  page.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`.slice(0, 240)));
  await page.goto(`${base}${candidate}.html?graph=${graph}${query}`);
  await page
    .waitForFunction(() => window.__bench?.ready || window.__bench?.failed, null, { timeout: 60000 })
    .catch(() => {});
  await page.waitForFunction(() => window.__bench?.fcp !== undefined, null, { timeout: 5000 }).catch(() => {});
  const counts = await page.evaluate(() => window.__benchApi?.counts?.() ?? null);
  const state = await page.evaluate(() => {
    const { api: _api, ...s } = window.__bench ?? {};
    return JSON.parse(JSON.stringify(s));
  });
  let pan = null;
  if (state.ready) {
    // A real drag from a point with no node under it; React Flow and sigma pan only on the background.
    const point = await page.evaluate(() => {
      const root = document.getElementById("root");
      const box = root.getBoundingClientRect();
      for (let y = box.top + 10; y < box.bottom - 10; y += 20) {
        for (let x = box.left + 10; x < box.right - 10; x += 20) {
          const el = document.elementFromPoint(x, y);
          if (el && (el.matches(".react-flow__pane") || el.tagName === "CANVAS")) {
            return { x, y };
          }
        }
      }
      return { x: box.left + 10, y: box.top + 10 };
    });
    const drag = await page.evaluate((p) => window.__benchPan({ ...p, frames: 120 }), point);
    const { deltas, work } = drag;
    pan = {
      start: drag.before,
      frames: deltas.length,
      p50: round(pct(deltas, 50)),
      p95: round(pct(deltas, 95)),
      max: round(Math.max(...deltas)),
      workP50: round(pct(work, 50)),
      workP95: round(pct(work, 95)),
      moved: drag.moved,
    };
    if (run === 0) {
      await mkdir(join(out, "screens"), { recursive: true });
      const shot = await page.screenshot({ path: join(out, "screens", `${candidate}-${graph}.png`) });
      const png = PNG.sync.read(shot);
      const colours = new Map();
      for (let i = 0; i < png.data.length; i += 4) {
        const c = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
        colours.set(c, (colours.get(c) ?? 0) + 1);
      }
      pan.drawnShare = round((1 - Math.max(...colours.values()) / (png.width * png.height)) * 100);
    }
  }
  const dom = await page.evaluate(() => document.querySelectorAll("#root *").length);
  await page.close();
  return {
    candidate,
    graph,
    run,
    ready: Boolean(state.ready),
    size: state.size,
    layoutMs: round(state.layoutMs),
    fcpMs: round(state.fcp),
    drawnMs: round(state.drawnAt),
    pan,
    counts,
    longTasks: state.longTasks,
    dom,
    violations: state.violations,
    errors: state.errors,
    console: consoleLines.slice(0, 6),
  };
}

async function sizes() {
  const byPage = {};
  const assets = {};
  for (const f of await readdir(join(dist, "assets"))) {
    const buf = await readFile(join(dist, "assets", f));
    assets[f] = { bytes: buf.length, gzip: gzipSync(buf).length };
  }
  for (const name of candidates) {
    const html = await readFile(join(dist, `${name}.html`), "utf8");
    const seen = new Set();
    const visit = async (file) => {
      if (seen.has(file) || !assets[file]) {
        return;
      }
      seen.add(file);
      if (file.endsWith(".js")) {
        const text = await readFile(join(dist, "assets", file), "utf8");
        for (const m of text.matchAll(/["'(]\.\/([\w.-]+\.(?:js|css))["')]/g)) {
          await visit(m[1]);
        }
      }
    };
    for (const m of html.matchAll(/assets\/([\w.-]+\.(?:js|css))/g)) {
      await visit(m[1]);
    }
    const files = [...seen];
    byPage[name] = {
      js: files.filter((f) => f.endsWith(".js")).reduce((a, f) => a + assets[f].bytes, 0),
      jsGzip: files.filter((f) => f.endsWith(".js")).reduce((a, f) => a + assets[f].gzip, 0),
      css: files.filter((f) => f.endsWith(".css")).reduce((a, f) => a + assets[f].bytes, 0),
    };
  }
  return byPage;
}

async function glInfo() {
  const browser = await chromium.launch({ channel: "chromium" });
  const page = await browser.newPage();
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return { userAgent: navigator.userAgent, webgl: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null };
  });
  info.version = browser.version();
  await browser.close();
  return info;
}

const checkpoint = join(out, "samples.json");
const results = await readFile(checkpoint, "utf8").then(JSON.parse, () => []);
await mkdir(out, { recursive: true });
for (let run = 0; run < runs; run++) {
  for (const graph of graphs) {
    for (const candidate of candidates) {
      if (results.some((r) => r.run === run && r.graph === graph && r.candidate === candidate && r.ready)) {
        continue;
      }
      // A fresh browser per sample, so no candidate inherits another's JIT or GPU state. The full Chromium build in
      // new-headless mode uses the GPU (ANGLE Metal on macOS), as a VS Code webview does; the headless shell falls back
      // to SwiftShader, which penalises the WebGL candidates.
      const browser = await chromium.launch({ channel: "chromium" });
      results.push(await measure(browser, candidate, graph, run));
      await browser.close();
      await writeFile(checkpoint, JSON.stringify(results));
      process.stdout.write(".");
    }
  }
}
server.close();

const median = (xs) => pct(xs.filter((x) => x != null), 50);
const summary = {};
for (const graph of graphs) {
  for (const candidate of candidates) {
    const rs = results.filter((r) => r.graph === graph && r.candidate === candidate);
    const pick = (f) => rs.map(f).filter((x) => x != null);
    const range = (xs) => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null);
    summary[`${candidate}/${graph}`] = {
      ready: rs.filter((r) => r.ready).length,
      runs: rs.length,
      size: rs[0]?.size,
      layoutMs: { median: median(pick((r) => r.layoutMs)), range: range(pick((r) => r.layoutMs)) },
      fcpMs: { median: median(pick((r) => r.fcpMs)), range: range(pick((r) => r.fcpMs)) },
      drawnMs: { median: median(pick((r) => r.drawnMs)), range: range(pick((r) => r.drawnMs)) },
      panP50: { median: median(pick((r) => r.pan?.p50)), range: range(pick((r) => r.pan?.p50)) },
      panP95: { median: median(pick((r) => r.pan?.p95)), range: range(pick((r) => r.pan?.p95)) },
      workP50: { median: median(pick((r) => r.pan?.workP50)), range: range(pick((r) => r.pan?.workP50)) },
      workP95: { median: median(pick((r) => r.pan?.workP95)), range: range(pick((r) => r.pan?.workP95)) },
      panned: rs.every((r) => r.pan?.moved),
      counts: rs[0]?.counts,
      dom: median(pick((r) => r.dom)),
      violations: [...new Set(rs.flatMap((r) => r.violations))],
      errors: [...new Set(rs.flatMap((r) => r.errors))].slice(0, 3),
    };
  }
}
await mkdir(out, { recursive: true });
await writeFile(
  join(out, "results.json"),
  JSON.stringify({ browser: await glInfo(), summary, bundles: await sizes(), results }, null, 2),
);
console.log(`\nwrote ${join(out, "results.json")}`);
