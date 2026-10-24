// Spike check: renders each design and reports, per table edge, whether it runs against the flow, and which cards
// other than its two ends it passes over. usage: node spike/gallery/check-edges.mjs [round] [designs...]
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? "/tmp/pw", "package.json"));
const { chromium } = require("playwright");
const here = path.dirname(new URL(import.meta.url).pathname);
const [round = "2", ...only] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1840, height: 900 } });
page.on("pageerror", (e) => console.log("ERR", e.message));
await page.goto(`${pathToFileURL(path.join(here, "designs.html"))}?round=${round}&theme=Default%20Dark%20Modern`);
await page.waitForFunction(() => document.title === "ready");
const out = await page.evaluate((only) => {
  const result = {};
  for (const panel of document.querySelectorAll("section.panel")) {
    const id = panel.className.match(/\bv([A-Z])\b/)[1];
    if (only.length && !only.includes(id)) continue;
    const vertical = panel.querySelector(".vJ, .vE") !== null || /\bv[EJM]\b/.test(panel.className);
    const cards = [...panel.querySelectorAll(".layer > .n")].map((n) => ({ id: n.dataset.id ?? n.firstElementChild?.dataset.id, r: n.firstElementChild.getBoundingClientRect() }));
    const issues = [];
    for (const p of panel.querySelectorAll("path.edge.table")) {
      const len = p.getTotalLength();
      const pts = Array.from({ length: 60 }, (_, i) => p.getPointAtLength((len * i) / 59)).map((q) => {
        const m = p.getScreenCTM();
        return { x: q.x * m.a + m.e, y: q.y * m.d + m.f };
      });
      const s = pts[0], e = pts.at(-1);
      const ends = cards.filter((c) => [s, e].some((q) => q.x >= c.r.left - 30 && q.x <= c.r.right + 30 && q.y >= c.r.top - 30 && q.y <= c.r.bottom + 30)).map((c) => c.id);
      let back = 0;
      for (let i = 1; i < pts.length; i++) back += Math.max(0, vertical ? pts[i - 1].y - pts[i].y : pts[i - 1].x - pts[i].x);
      const over = new Set();
      for (const q of pts.slice(2, -2)) {
        for (const c of cards) {
          if (ends.includes(c.id)) continue;
          if (q.x > c.r.left + 2 && q.x < c.r.right - 2 && q.y > c.r.top + 2 && q.y < c.r.bottom - 2) over.add(c.id);
        }
      }
      p.__pts = pts; p.__ends = [p.dataset.a ?? ends[0], p.dataset.b ?? ends[1]];
      // A within-layer edge runs across the flow, so only its cards-in-the-way check applies.
      if (p.dataset.same) back = 0;
      if (back > 4 || over.size) issues.push(`${ends.join("->")}${back > 4 ? ` backwards ${Math.round(back)}px` : ""}${over.size ? ` over ${[...over].join(",")}` : ""}`);
    }
    // Crossings: pairs of table edges whose sampled polylines intersect away from a shared end.
    const es = [...panel.querySelectorAll("path.edge.table")];
    const cross = (a, b, c, d) => {
      const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
      return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
    };
    let crossings = 0;
    const pairs = [];
    for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) {
      // Edges into or out of the same card meet at that card on purpose; drop the samples within 16px of either
      // end so only a crossing on the way counts.
      const near = (q, P) => Math.hypot(q.x - P[0].x, q.y - P[0].y) < 28 || Math.hypot(q.x - P.at(-1).x, q.y - P.at(-1).y) < 28;
      const A = es[i].__pts.filter((q) => !near(q, es[i].__pts) && !near(q, es[j].__pts));
      const B = es[j].__pts.filter((q) => !near(q, es[j].__pts) && !near(q, es[i].__pts));
      let hit = false;
      for (let k = 1; k < A.length && !hit; k++) for (let m = 1; m < B.length && !hit; m++) hit = cross(A[k - 1], A[k], B[m - 1], B[m]);
      if (hit) { crossings++; pairs.push(`${es[i].__ends.join(">")} x ${es[j].__ends.join(">")}`); }
    }
    if (crossings) issues.push(`${crossings} crossings: ${pairs.join(" | ")}`);
    result[id] = issues;
  }
  return result;
}, only);
for (const [id, issues] of Object.entries(out)) console.log(`${id}: ${issues.length ? issues.join("; ") : "clean"}`);
await browser.close();
