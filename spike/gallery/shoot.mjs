// Spike: screenshots each lineage design in every captured theme, and collects the contrast report.
// usage: node spike/gallery/shoot.mjs <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Playwright is installed outside the repo (`npm i playwright` in $PLAYWRIGHT_DIR, default /tmp/pw).
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? "/tmp/pw", "package.json"));
const { chromium } = require("playwright");
const out = path.resolve(process.argv[2] ?? "out/spike-gallery");
mkdirSync(out, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const themes = Object.keys(
  JSON.parse(readFileSync(path.join(here, "themes.js"), "utf8").replace(/^window\.THEMES = /, "").replace(/;\s*$/, "")),
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1840, height: 900 }, deviceScaleFactor: 1 });
const round = process.env.ROUND ?? "1";
const report = [];
for (const theme of themes) {
  const slug = theme.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  await page.goto(`${pathToFileURL(path.join(here, "designs.html"))}?round=${round}&theme=${encodeURIComponent(theme)}`);
  await page.waitForFunction(() => document.title === "ready");
  await page.evaluate(() => document.fonts.ready);
  for (const panel of await page.locator("section.panel").all()) {
    const id = (await panel.getAttribute("class")).match(/\bv([A-Z])\b/)[1];
    await panel.screenshot({ path: path.join(out, `${id}-${slug}.png`) });
  }
  report.push(await page.evaluate(() => window.REPORT));
}
await browser.close();
writeFileSync(path.join(out, `report-r${round}.json`), JSON.stringify(report, null, 1));
console.log(`shot ${themes.length} themes into ${out}`);
