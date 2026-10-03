// One page per candidate. The incumbent resolves from the repository's webview install, and Tailwind runs with the
// panel's own config so its `al-` classes are generated as the lineage entry generates them.
import react from "@vitejs/plugin-react";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const here = import.meta.dirname;
const webview = process.env.FPU_WEBVIEW_PANELS ?? path.resolve(here, "../../../webview_panels");
const requireWebview = createRequire(path.join(webview, "package.json"));
const pages = Object.fromEntries(
  readdirSync(here)
    .filter((f) => f.endsWith(".html"))
    .map((f) => [path.basename(f, ".html"), path.join(here, f)]),
);

export default defineConfig(async () => {
  const tailwind = requireWebview("tailwindcss");
  const loadConfig = requireWebview("tailwindcss/loadConfig");
  const panelConfig = loadConfig(path.join(webview, "tailwind.config.ts"));
  return {
    base: "./",
    plugins: [react()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "@altimateai/ui-components/lineage": path.join(webview, "node_modules/@altimateai/ui-components/dist/lineage.js"),
        "@altimateai/ui-components/styles.css": path.join(webview, "node_modules/@altimateai/ui-components/dist/styles.css"),
        "@webview-lineage": path.join(webview, "src/modules/lineage"),
        bootstrap: path.join(webview, "node_modules/bootstrap"),
      },
    },
    css: {
      postcss: {
        plugins: [
          tailwind({
            ...panelConfig,
            content: [
              path.join(here, "src/incumbent.jsx"),
              path.join(webview, "node_modules/@altimateai/ui-components/dist/**/*.js"),
            ],
          }),
        ],
      },
    },
    build: {
      target: "chrome148",
      cssMinify: "esbuild",
      assetsInlineLimit: 0,
      outDir: process.env.FPU_SPIKE_OUT ?? "dist",
      emptyOutDir: true,
      rolldownOptions: { input: pages },
    },
  };
});
