import { defineConfig } from "vite";

// Mirrors the panel build: relative asset paths, and WebAssembly emitted as files, never inlined as data: URLs.
export default defineConfig({
  base: "./",
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: { input: { index: "index.html", inline: "inline.html" } },
  },
});
