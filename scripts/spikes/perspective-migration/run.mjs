// Serves the built spike under the query-results panel policy (`contentSecurityPolicy` in src/webview/panelHtml.ts)
// and records, per variant, what the page reports with one allowance removed.
import { createServer } from "node:http";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const dist = new URL("./dist/", import.meta.url).pathname;
const out = process.argv[2] ?? new URL("./out/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };

function policy(origin, nonce, drop) {
  const wasm = drop === "wasm-unsafe-eval" ? "" : " 'wasm-unsafe-eval'";
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${origin}${wasm}`,
    `style-src ${origin} 'unsafe-inline'`,
    `font-src ${origin}`,
    `img-src ${origin} data:`,
    ...(drop === "connect-src" ? [] : [`connect-src ${origin}`]),
    ...(drop === "worker-src blob:" ? [] : ["worker-src blob:"]),
  ].join("; ");
}

let variant = "none";
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(dist, path === "/" ? "index.html" : path);
  try {
    let body = await readFile(file);
    if (file.endsWith(".html")) {
      const origin = `http://${req.headers.host}`;
      const nonce = "c3Bpa2Vub25jZQ";
      body = body
        .toString()
        .replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy(origin, nonce, variant)}">`)
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

async function sizes() {
  const rows = [];
  const walk = async (dir) => {
    for (const name of await readdir(dir)) {
      const p = join(dir, name);
      if ((await stat(p)).isDirectory()) {
        await walk(p);
      } else {
        const buf = await readFile(p);
        rows.push({ file: p.slice(dist.length), bytes: buf.length, gzip: gzipSync(buf).length });
      }
    }
  };
  await walk(dist);
  return rows.sort((a, b) => b.bytes - a.bytes);
}

await mkdir(out, { recursive: true });
const results = { sizes: await sizes(), variants: {} };
// `inline:` variants load the build that embeds the WebAssembly in its JavaScript instead of fetching it.
const variants = ["none", "wasm-unsafe-eval", "worker-src blob:", "connect-src", "inline:none", "inline:connect-src", "inline:wasm-unsafe-eval"];
for (const name of variants) {
  const inline = name.startsWith("inline:");
  const v = inline ? name.slice(7) : name;
  variant = v;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 940, height: 700 } });
  const console_ = [];
  page.on("console", (m) => console_.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  page.on("pageerror", (e) => console_.push(`pageerror: ${e.message}`.slice(0, 300)));
  await page.goto(inline ? `${base}inline.html` : base);
  await page.waitForFunction(() => window.__spike?.done, null, { timeout: 30000 }).catch(() => {});
  const spike = await page.evaluate(() => {
    const s = window.__spike ?? {};
    return JSON.parse(JSON.stringify(s, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  });
  if (name === "none") {
    await page.evaluate(() => {
      const viewer = document.querySelector("#grid-host perspective-viewer");
      return viewer.restore({ group_by: [], filter: [], sort: [], columns: ["id", "label", "payload", "note"] });
    });
    await page.waitForTimeout(500);
    for (const host of ["#grid-host", "#chart-host"]) {
      const png = PNG.sync.read(await page.locator(host).screenshot());
      const colours = new Map();
      for (let i = 0; i < png.data.length; i += 4) {
        const c = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
        colours.set(c, (colours.get(c) ?? 0) + 1);
      }
      const background = Math.max(...colours.values());
      (spike.pixels ??= {})[host] = {
        distinctColours: colours.size,
        nonBackgroundShare: Math.round((1 - background / (png.width * png.height)) * 1000) / 1000,
      };
    }
    spike.click = await page.evaluate(async () => {
      const viewer = document.querySelector("#grid-host perspective-viewer");
      await viewer.flush();
      const table = viewer.querySelector("perspective-viewer-datagrid").regular_table;
      const icons = [...table.querySelectorAll(".open-icon")];
      const byColumn = {};
      for (const icon of icons) {
        const header = table.getMeta(icon.parentElement).column_header;
        const name = Array.isArray(header) ? header.at(-1) : header;
        byColumn[name] = (byColumn[name] ?? 0) + 1;
      }
      const payload = icons.find((icon) => {
        const header = table.getMeta(icon.parentElement).column_header;
        return (Array.isArray(header) ? header.at(-1) : header) === "payload";
      });
      payload?.parentElement.click();
      const chart = document.querySelector("#chart-host perspective-viewer");
      const plugin = chart.querySelector("perspective-viewer-charts-y-bar");
      const canvases = [...(plugin?.shadowRoot ?? plugin)?.querySelectorAll("canvas") ?? []];
      return {
        icons: icons.length,
        byColumn,
        opened: window.__spike.opened.slice(-1),
        chartCanvases: canvases.map((c) => `${c.width}x${c.height}`),
        themes: await viewer.getAllThemes?.(),
        plugins: [...new Set([...document.querySelectorAll("*")].map((e) => e.tagName.toLowerCase()))].filter((t) =>
          t.startsWith("perspective-viewer-"),
        ),
      };
    });
  }
  await page.screenshot({ path: join(out, `${name.replace(/[^a-z]+/g, "-")}.png`) });
  results.variants[name] = { spike, console: console_ };
  await browser.close();
}
server.close();
await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2));
console.log(`wrote ${join(out, "results.json")}`);
