import react from "@vitejs/plugin-react";
import { cpSync } from "fs";
import path from "path";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    svgr(),
    react(),
    {
      name: "copy-codicons",
      renderStart: () => {
        cpSync(
          "./node_modules/@vscode/codicons/dist",
          "./dist/assets/codicons/",
          { recursive: true },
        );
      },
    },
  ],
  build: {
    cssMinify: "esbuild",
    cssCodeSplit: false,
    rollupOptions: {
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
