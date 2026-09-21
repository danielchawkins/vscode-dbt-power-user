import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { defineConfig, type Plugin } from "vite";
import svgr from "vite-plugin-svgr";

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
  plugins: [svgr(), react(), copyCodicons()],
  build: {
    target: "chrome148",
    cssMinify: "esbuild",
    cssCodeSplit: false,
    rolldownOptions: {
      input: "./src/main.tsx",
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/chunk-[name].js`,
        assetFileNames: (assetInfo) =>
          assetInfo.name === "style.css"
            ? "assets/main.css"
            : "assets/[name].[ext]",
      },
    },
  },
  resolve: {
    alias: {
      "@uicore": path.resolve(import.meta.dirname, "./src/uiCore"),
      "@assets": path.resolve(import.meta.dirname, "./src/assets"),
      "@modules": path.resolve(import.meta.dirname, "./src/modules"),
      "@testUtils": path.resolve(import.meta.dirname, "./src/testUtils"),
      "@vscodeApi": path.resolve(import.meta.dirname, "./src/modules/vscode"),
    },
  },
  css: {
    modules: {
      localsConvention: "dashes",
    },
  },
});

export default viteConfig;
