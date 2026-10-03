import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import svgr from "vite-plugin-svgr";

const entriesDir = path.resolve(import.meta.dirname, "src/entries");

/** One input per panel, named for its file in `src/entries`; the host loads `assets/<name>.js`. */
const panelEntries = Object.fromEntries(
  readdirSync(entriesDir)
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => [path.basename(file, ".tsx"), path.join(entriesDir, file)]),
);

function copyCodicons(): Plugin {
  const srcDir = path.resolve(
    import.meta.dirname,
    "node_modules/@vscode/codicons/dist",
  );
  let destDir: string;

  return {
    name: "copy-codicons",
    configResolved: (config) => {
      destDir = path.resolve(
        config.root,
        config.build.outDir,
        "assets/codicons",
      );
    },
    renderStart: () => {
      const cssSrc = path.join(srcDir, "codicon.css");
      const ttfSrc = path.join(srcDir, "codicon.ttf");
      if (!existsSync(cssSrc)) {
        throw new Error(`Missing Codicons asset: ${cssSrc}`);
      }
      if (!existsSync(ttfSrc)) {
        throw new Error(`Missing Codicons asset: ${ttfSrc}`);
      }
      mkdirSync(destDir, { recursive: true });
      copyFileSync(cssSrc, path.join(destDir, "codicon.css"));
      copyFileSync(ttfSrc, path.join(destDir, "codicon.ttf"));
    },
  };
}

// https://vitejs.dev/config/
export const viteConfig = defineConfig({
  // Webviews load each entry from a vscode-resource URL, so emitted asset URLs must resolve relative to it.
  base: "./",
  plugins: [svgr(), react(), copyCodicons()],
  build: {
    target: "chrome148",
    // The host reads each entry's script and transitive stylesheets from here.
    manifest: "assets/manifest.json",
    rolldownOptions: {
      input: panelEntries,
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/chunk-[name].js`,
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@uicore": path.resolve(import.meta.dirname, "./src/uiCore"),
      "@assets": path.resolve(import.meta.dirname, "./src/assets"),
      "@modules": path.resolve(import.meta.dirname, "./src/modules"),
      "@vscodeApi": path.resolve(import.meta.dirname, "./src/modules/vscode"),
    },
  },
  // The dev server only pre-bundles linked workspace packages that are listed here.
  optimizeDeps: {
    include: ["@fusion-power-user/webview-contract"],
  },
  css: {
    modules: {
      localsConvention: "dashes",
    },
  },
});

export default viteConfig;
