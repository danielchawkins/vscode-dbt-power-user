// Writes one HTML page per candidate; run once before `vite build`.
import { writeFileSync } from "node:fs";

const candidates = {
  incumbent: "incumbent.jsx",
  "xyflow-elk": "xyflow-elk.jsx",
  "xyflow-dagre": "xyflow-dagre.jsx",
  cytoscape: "cytoscape.js",
  sigma: "sigma.js",
};
for (const [name, entry] of Object.entries(candidates)) {
  writeFileSync(
    new URL(`./${name}.html`, import.meta.url),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${name}</title>
    <link rel="stylesheet" href="./src/page.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/${entry}"></script>
  </body>
</html>
`,
  );
}
