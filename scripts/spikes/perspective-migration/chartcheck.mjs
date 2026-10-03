// Confirms the viewer-charts bar chart draws: the chart region's pixels with data versus filtered to no rows.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const dist = new URL("./dist/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(dist, p === "/" ? "index.html" : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "chromium" });
const page = await browser.newPage({ viewport: { width: 940, height: 700 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForFunction(() => window.__spike?.done, null, { timeout: 30000 });
const shot = async () => {
  await page.waitForTimeout(800);
  const png = PNG.sync.read(await page.locator("#chart-host").screenshot());
  const colours = new Map();
  for (let i = 0; i < png.data.length; i += 4) {
    const c = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    colours.set(c, (colours.get(c) ?? 0) + 1);
  }
  return { distinct: colours.size, share: 1 - Math.max(...colours.values()) / (png.width * png.height) };
};
const withData = await shot();
await page.evaluate(() =>
  document.querySelector("#chart-host perspective-viewer").restore({ filter: [["label", "==", "none"]] }),
);
const empty = await shot();
await page.evaluate(() => document.querySelector("#chart-host perspective-viewer").restore({ filter: [] }));
const restored = await shot();
console.log(JSON.stringify({ withData, empty, restored }));
await browser.close();
server.close();
